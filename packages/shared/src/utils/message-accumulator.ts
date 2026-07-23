import type { DynamicToolUIPart, ReasoningUIPart, TextUIPart, UIMessage, UIMessageChunk } from "ai";
import { ConsoleLogger, type Logger } from "../logging";

type MessageParts = UIMessage["parts"];
type MessagePart = MessageParts[number];

// The data chunk's discriminant is a template literal (`data-${string}`), which
// can't appear as a switch case label. Narrow it out with a type guard before
// the switch so the `never` exhaustiveness check still holds.
type DataUIMessageChunk = Extract<UIMessageChunk, { type: `data-${string}` }>;

function isDataChunk(chunk: UIMessageChunk): chunk is DataUIMessageChunk {
  return chunk.type.startsWith("data-");
}

// Writable view over DynamicToolUIPart's discriminated union. The SDK type
// requires state and fields (input/output/errorText) to be set together per
// variant, which blocks in-place mutation as the tool transitions states.
// We keep the object identity but relax field constraints for mutation.
type MutableDynamicToolUIPart = Omit<DynamicToolUIPart, "state" | "input" | "output" | "errorText"> & {
  state: DynamicToolUIPart["state"];
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
  startedAt?: string;
  endedAt?: string;
};

type MutableReasoningUIPart = ReasoningUIPart & {
  startedAt?: string;
  endedAt?: string;
};

export interface ProcessChunkResult {
  /**
   * If finished, the complete message.
   */
  finishedMessage?: UIMessage;
  /**
   * The parts that were completed by this chunk.
   */
  completedParts: MessagePart[];
}

export interface ProcessChunkOptions {
  receivedAt?: number;
}

/**
 * Accumulates UIMessageStream chunks into a complete UIMessage.
 * Used by the DO to build the final message for storage while streaming parts to clients.
 * Also used by the vm-agent test harness to validate chunk ordering in isolation.
 *
 * Ordering: parts are inserted into `parts` when their opening chunk arrives
 * (text-start / reasoning-start / tool-input-start) and mutated in place as
 * deltas and terminal chunks arrive. This mirrors the AI SDK's
 * processUIMessageStream and preserves the order in which parts began
 * streaming, even when a later part finishes before an earlier one.
 *
 * Timing: stamps message-level `startedAt`/`endedAt` on `metadata`, plus
 * per-reasoning-part and per-tool-part `startedAt`/`endedAt` for live and
 * historical duration displays.
 */
export class MessageAccumulator {
  private readonly logger: Logger;
  private messageId: string | undefined = undefined;
  private parts: MessageParts = [];
  private metadata: Record<string, unknown> | undefined = undefined;
  private finished = false;
  private pendingChunks: UIMessageChunk[] = [];

  // Active in-progress parts, keyed by their stream id. Values are the same
  // references stored in `parts`, so mutations here update the array too.
  private activeTextParts = new Map<string, TextUIPart>();
  private activeReasoningParts = new Map<string, MutableReasoningUIPart>();

  // Active tool calls, keyed by toolCallId. Holds the part reference plus
  // input-text accumulation used only as a repair path if `tool-input-available`
  // is never received.
  private toolCalls = new Map<
    string,
    {
      part: MutableDynamicToolUIPart;
      inputText: string;
    }
  >();

  constructor(logger?: Logger) {
    this.logger = logger ?? new ConsoleLogger({}, "MessageAccumulator");
  }

  /**
   * Process a stream chunk and accumulate it into the message.
   * @returns message completion state plus any parts fully materialized by this chunk
   */
  process(
    chunk: UIMessageChunk,
    options: ProcessChunkOptions = {},
  ): ProcessChunkResult {
    const now = options.receivedAt ?? Date.now();
    const nowISO = new Date(now).toISOString();
    this.stampMessageStartedIfNeeded(now);
    this.pendingChunks.push(chunk);
    const completedParts: MessagePart[] = [];

    if (isDataChunk(chunk)) {
      // TODO: handle custom data parts (chunk.data, chunk.id, chunk.transient)
      return { completedParts };
    }

    switch (chunk.type) {
      case "start":
        if (this.messageId && chunk.messageId && this.messageId !== chunk.messageId) {
          this.logger.warn("[chunk-trace] start chunk with mismatched messageId", {
            fields: { chunkMessageId: chunk.messageId ?? "undefined", currentMessageId: this.messageId },
          });
        }
        if (!chunk.messageId) {
          // invariant: the harnesses should always generate a messageId
          this.logger.error("received start chunk with no messageId!");
        }
        this.messageId = chunk.messageId ?? this.messageId;
        break;

      case "text-start": {
        const textPart: TextUIPart = { type: "text", text: "", state: "streaming" };
        this.activeTextParts.set(chunk.id, textPart);
        this.parts.push(textPart);
        break;
      }

      case "text-delta": {
        const textPart = this.activeTextParts.get(chunk.id);
        if (textPart) {
          textPart.text += chunk.delta;
        } else {
          this.logger.warn("[chunk-trace] text-delta received for unknown id", {
            fields: { chunkId: chunk.id, activeIds: [...this.activeTextParts.keys()] },
          });
        }
        break;
      }

      case "text-end": {
        const textPart = this.activeTextParts.get(chunk.id);
        if (textPart) {
          textPart.state = "done";
          this.activeTextParts.delete(chunk.id);
          completedParts.push(textPart);
        }
        break;
      }

      case "reasoning-start": {
        const reasoningPart: MutableReasoningUIPart = {
          type: "reasoning",
          text: "",
          state: "streaming",
          startedAt: nowISO,
        };
        this.activeReasoningParts.set(chunk.id, reasoningPart);
        this.parts.push(reasoningPart);
        break;
      }

      case "reasoning-delta": {
        const reasoningPart = this.activeReasoningParts.get(chunk.id);
        if (reasoningPart) {
          reasoningPart.text += chunk.delta;
        } else {
          this.logger.warn("[chunk-trace] reasoning-delta for unknown id", {
            fields: { chunkId: chunk.id, activeIds: [...this.activeReasoningParts.keys()] },
          });
        }
        break;
      }

      case "reasoning-end": {
        const reasoningPart = this.activeReasoningParts.get(chunk.id);
        if (reasoningPart) {
          reasoningPart.state = "done";
          reasoningPart.endedAt = nowISO;
          this.activeReasoningParts.delete(chunk.id);
          completedParts.push(reasoningPart);
        }
        break;
      }

      case "tool-input-start": {
        const toolPart: MutableDynamicToolUIPart = {
          type: "dynamic-tool",
          toolName: chunk.toolName,
          toolCallId: chunk.toolCallId,
          state: "input-streaming",
          input: undefined,
          title: chunk.title,
          providerExecuted: chunk.providerExecuted,
          startedAt: nowISO,
        };
        this.toolCalls.set(chunk.toolCallId, { part: toolPart, inputText: "" });
        this.parts.push(toolPart as DynamicToolUIPart);
        break;
      }

      case "tool-input-delta": {
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.inputText += chunk.inputTextDelta;
        } else {
          this.logger.warn("[chunk-trace] tool-input-delta for unknown toolCallId", {
            fields: { toolCallId: chunk.toolCallId, knownToolCallIds: [...this.toolCalls.keys()] },
          });
        }
        break;
      }

      case "tool-input-available": {
        const existing = this.toolCalls.get(chunk.toolCallId);
        if (existing) {
          existing.part.input = chunk.input;
          existing.part.state = "input-available";
          // startedAt was already set by tool-input-start
        } else {
          // No prior tool-input-start — fall back to inserting the part now.
          const toolPart: MutableDynamicToolUIPart = {
            type: "dynamic-tool",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            state: "input-available",
            input: chunk.input,
            title: chunk.title,
            providerExecuted: chunk.providerExecuted,
            startedAt: nowISO,
          };
          this.toolCalls.set(chunk.toolCallId, { part: toolPart, inputText: "" });
          this.parts.push(toolPart as DynamicToolUIPart);
        }
        break;
      }

      case "tool-input-error": {
        // Tool input failed to parse/validate. Terminal: the SDK maps this to
        // an `output-error` part carrying the raw input and the error text.
        const existing = this.toolCalls.get(chunk.toolCallId);
        if (existing) {
          existing.part.input = chunk.input;
          existing.part.errorText = chunk.errorText;
          existing.part.state = "output-error";
          existing.part.endedAt = nowISO;
          this.toolCalls.delete(chunk.toolCallId);
          completedParts.push(existing.part as DynamicToolUIPart);
        } else {
          // No prior tool-input-start — insert a completed error part now.
          const toolPart: MutableDynamicToolUIPart = {
            type: "dynamic-tool",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            state: "output-error",
            input: chunk.input,
            errorText: chunk.errorText,
            title: chunk.title,
            providerExecuted: chunk.providerExecuted,
            startedAt: nowISO,
            endedAt: nowISO,
          };
          this.parts.push(toolPart as DynamicToolUIPart);
          completedParts.push(toolPart as DynamicToolUIPart);
        }
        break;
      }

      case "tool-output-available": {
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.part.output = chunk.output;
          toolCall.part.state = "output-available";
          toolCall.part.endedAt = nowISO;
          this.toolCalls.delete(chunk.toolCallId);
          completedParts.push(toolCall.part as DynamicToolUIPart);
        }
        break;
      }

      case "tool-output-error": {
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.part.errorText = chunk.errorText;
          toolCall.part.state = "output-error";
          toolCall.part.endedAt = nowISO;
          this.toolCalls.delete(chunk.toolCallId);
          completedParts.push(toolCall.part as DynamicToolUIPart);
        }
        break;
      }

      case "tool-approval-request": {
        // Non-terminal: the tool is waiting on a human approval decision.
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.part.state = "approval-requested";
          toolCall.part.approval = { id: chunk.approvalId };
        } else {
          this.logger.warn("[chunk-trace] tool-approval-request for unknown toolCallId", {
            fields: { toolCallId: chunk.toolCallId, knownToolCallIds: [...this.toolCalls.keys()] },
          });
        }
        break;
      }

      case "tool-output-denied": {
        // Terminal: the approval was denied, so the tool never produced output.
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.part.state = "output-denied";
          toolCall.part.approval = { ...(toolCall.part.approval ?? { id: "" }), approved: false };
          toolCall.part.endedAt = nowISO;
          this.toolCalls.delete(chunk.toolCallId);
          completedParts.push(toolCall.part as DynamicToolUIPart);
        } else {
          this.logger.warn("[chunk-trace] tool-output-denied for unknown toolCallId", {
            fields: { toolCallId: chunk.toolCallId, knownToolCallIds: [...this.toolCalls.keys()] },
          });
        }
        break;
      }

      case "source-url": {
        const messagePart = {
          type: "source-url",
          sourceId: chunk.sourceId,
          url: chunk.url,
          title: chunk.title,
          providerMetadata: chunk.providerMetadata,
        } as MessagePart;
        this.parts.push(messagePart);
        completedParts.push(messagePart);
        break;
      }

      case "source-document": {
        const messagePart = {
          type: "source-document",
          sourceId: chunk.sourceId,
          mediaType: chunk.mediaType,
          title: chunk.title,
          filename: chunk.filename,
          providerMetadata: chunk.providerMetadata,
        } as MessagePart;
        this.parts.push(messagePart);
        completedParts.push(messagePart);
        break;
      }

      case "file": {
        const messagePart = {
          type: "file",
          mediaType: chunk.mediaType,
          url: chunk.url,
          providerMetadata: chunk.providerMetadata,
        } as MessagePart;
        this.parts.push(messagePart);
        completedParts.push(messagePart);
        break;
      }

      case "start-step": {
        const messagePart = { type: "step-start" } as MessagePart;
        this.parts.push(messagePart);
        completedParts.push(messagePart);
        break;
      }

      case "finish":
        completedParts.push(...this.finalizePendingParts(now));
        this.mergeMetadataOnTerminate(
          chunk.messageMetadata as Record<string, unknown> | undefined,
          now,
        );
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };

      case "finish-step":
        break;

      case "message-metadata":
        this.metadata = {
          ...(this.metadata ?? {}),
          ...((chunk.messageMetadata as Record<string, unknown> | undefined) ?? {}),
        };
        break;

      case "abort":
        completedParts.push(...this.finalizePendingParts(now));
        this.mergeMetadataOnTerminate({ aborted: true }, now);
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };

      case "error":
        completedParts.push(...this.finalizePendingParts(now));
        this.mergeMetadataOnTerminate(undefined, now);
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };

      default: {
        // Runtime log: a chunk type the union doesn't know about can still
        // arrive (SDK version skew, malformed chunk over the wire).
        const chunkType = (chunk as { type?: unknown }).type;
        this.logger.warn("Unhandled chunk type", {
          fields: { chunkType: typeof chunkType === "string" ? chunkType : "unknown" },
        });
        // Compile-time tripwire: build breaks if a new chunk type is added to
        // the union and left unhandled above.
        const _exhaustiveCheck: never = chunk;
        void _exhaustiveCheck;
      }
    }

    return { completedParts };
  }

  /**
   * Stamp `metadata.startedAt` on the very first chunk we see, so even streams
   * that begin with `text-start` (no explicit `start` chunk) still get a
   * message-level start timestamp.
   */
  private stampMessageStartedIfNeeded(now: number): void {
    if (this.metadata?.startedAt === undefined) {
      this.metadata = { ...(this.metadata ?? {}), startedAt: new Date(now).toISOString() };
    }
  }

  /**
   * Shallow-merge provider `messageMetadata` into existing metadata, preserving
   * any existing `startedAt` and stamping `endedAt`.
   */
  private mergeMetadataOnTerminate(
    incoming: Record<string, unknown> | undefined,
    now: number,
  ): void {
    const existing = this.metadata ?? {};
    const merged: Record<string, unknown> = { ...existing, ...(incoming ?? {}) };
    if (existing.startedAt !== undefined) {
      merged.startedAt = existing.startedAt;
    }
    merged.endedAt = new Date(now).toISOString();
    this.metadata = merged;
  }

  /**
   * Close out any parts still in-flight at terminal-chunk time.
   * Parts are already in `this.parts`; we just mutate their state and
   * report them via completedParts so consumers see the close-out.
   */
  private finalizePendingParts(now = Date.now()): MessagePart[] {
    const completedParts: MessagePart[] = [];

    for (const [, textPart] of this.activeTextParts) {
      textPart.state = "done";
      completedParts.push(textPart);
    }
    this.activeTextParts.clear();

    for (const [, reasoningPart] of this.activeReasoningParts) {
      reasoningPart.state = "done";
      if (reasoningPart.endedAt === undefined) {
        reasoningPart.endedAt = new Date(now).toISOString();
      }
      completedParts.push(reasoningPart);
    }
    this.activeReasoningParts.clear();

    for (const [, toolCall] of this.toolCalls) {
      // Try to repair input from the streamed input-text if input never became available.
      if (toolCall.part.input === undefined && toolCall.inputText) {
        try {
          toolCall.part.input = JSON.parse(toolCall.inputText);
        } catch {
          toolCall.part.input = toolCall.inputText;
        }
      }
      if (toolCall.part.endedAt === undefined) {
        toolCall.part.endedAt = new Date(now).toISOString();
      }
      completedParts.push(toolCall.part as DynamicToolUIPart);
    }
    this.toolCalls.clear();

    return completedParts;
  }

  private getMessage(): UIMessage | null {
    if (!this.finished) { return null; }

    return {
      // typically the id will be null until the end. the harnesses do not declare an id in their start chunks (afaict)
      id: this.messageId ?? crypto.randomUUID(),
      role: "assistant",
      parts: this.parts,
      ...(this.metadata !== undefined && { metadata: this.metadata }),
    };
  }

  isFinished(): boolean {
    return this.finished;
  }

  getMessageId(): string | null {
    return this.messageId ?? null;
  }

  getPendingChunks(): UIMessageChunk[] | undefined {
    return this.pendingChunks.length > 0
      ? [...this.pendingChunks]
      : undefined;
  }

  /**
   * Finalizes the in-progress message as aborted without requiring a finish chunk.
   * Used when the agent process dies unexpectedly mid-stream.
   * @returns the partial message, or null if no message was started.
   */
  forceAbort(): UIMessage | null {
    if (
      this.parts.length === 0
      && this.activeTextParts.size === 0
      && this.activeReasoningParts.size === 0
      && this.toolCalls.size === 0
    ) {
      return null;
    }
    if (!this.messageId) {
      this.messageId = crypto.randomUUID();
    }
    const now = Date.now();
    this.finalizePendingParts(now);
    this.mergeMetadataOnTerminate({ aborted: true }, now);
    this.finished = true;
    return this.getMessage();
  }

  reset(): void {
    this.pendingChunks = [];
    this.messageId = undefined;
    this.parts = [];
    this.metadata = undefined;
    this.finished = false;
    this.activeTextParts.clear();
    this.activeReasoningParts.clear();
    this.toolCalls.clear();
  }
}
