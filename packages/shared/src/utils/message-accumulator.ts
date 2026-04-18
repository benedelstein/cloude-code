import type { DynamicToolUIPart, ReasoningUIPart, TextUIPart, UIMessage, UIMessageChunk } from "ai";
import { ConsoleLogger, type Logger } from "../logging";

type MessageParts = UIMessage["parts"];
type MessagePart = MessageParts[number];

// Writable view over DynamicToolUIPart's discriminated union. The SDK type
// requires state and fields (input/output/errorText) to be set together per
// variant, which blocks in-place mutation as the tool transitions states.
// We keep the object identity but relax field constraints for mutation.
type MutableDynamicToolUIPart = Omit<DynamicToolUIPart, "state" | "input" | "output" | "errorText"> & {
  state: DynamicToolUIPart["state"];
  input?: unknown;
  output?: unknown;
  errorText?: string;
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
 */
export class MessageAccumulator {
  private readonly logger: Logger;
  private messageId: string | undefined = undefined;
  private parts: MessageParts = [];
  private metadata: unknown = undefined;
  private finished = false;
  private pendingChunks: UIMessageChunk[] = [];

  // Active in-progress parts, keyed by their stream id. Values are the same
  // references stored in `parts`, so mutations here update the array too.
  private activeTextParts = new Map<string, TextUIPart>();
  private activeReasoningParts = new Map<string, ReasoningUIPart>();

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
  process(chunk: UIMessageChunk): ProcessChunkResult {
    this.pendingChunks.push(chunk);
    const completedParts: MessagePart[] = [];

    switch (chunk.type) {
      case "start":
        if (this.messageId && chunk.messageId && this.messageId !== chunk.messageId) {
          this.logger.warn(`[chunk-trace] start chunk with mismatched messageId`, {
            fields: { chunkMessageId: chunk.messageId ?? "undefined", currentMessageId: this.messageId },
          });
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
          this.logger.warn(`[chunk-trace] text-delta received for unknown id`, {
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
        const reasoningPart: ReasoningUIPart = { type: "reasoning", text: "", state: "streaming" };
        this.activeReasoningParts.set(chunk.id, reasoningPart);
        this.parts.push(reasoningPart);
        break;
      }

      case "reasoning-delta": {
        const reasoningPart = this.activeReasoningParts.get(chunk.id);
        if (reasoningPart) {
          reasoningPart.text += chunk.delta;
        } else {
          this.logger.warn(`[chunk-trace] reasoning-delta for unknown id`, {
            fields: { chunkId: chunk.id, activeIds: [...this.activeReasoningParts.keys()] },
          });
        }
        break;
      }

      case "reasoning-end": {
        const reasoningPart = this.activeReasoningParts.get(chunk.id);
        if (reasoningPart) {
          reasoningPart.state = "done";
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
          this.logger.warn(`[chunk-trace] tool-input-delta for unknown toolCallId`, {
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
          };
          this.toolCalls.set(chunk.toolCallId, { part: toolPart, inputText: "" });
          this.parts.push(toolPart as DynamicToolUIPart);
        }
        break;
      }

      case "tool-output-available": {
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.part.output = chunk.output;
          toolCall.part.state = "output-available";
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
          this.toolCalls.delete(chunk.toolCallId);
          completedParts.push(toolCall.part as DynamicToolUIPart);
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
        completedParts.push(...this.finalizePendingParts());
        this.metadata = chunk.messageMetadata;
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };

      case "finish-step":
        break;

      case "abort":
        completedParts.push(...this.finalizePendingParts());
        this.metadata = { ...((this.metadata as Record<string, unknown>) ?? {}), aborted: true };
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };

      case "error":
        completedParts.push(...this.finalizePendingParts());
        this.finished = true;
        return { finishedMessage: this.getMessage() ?? undefined, completedParts };
    }

    return { completedParts };
  }

  /**
   * Close out any parts still in-flight at terminal-chunk time.
   * Parts are already in `this.parts`; we just mutate their state and
   * report them via completedParts so consumers see the close-out.
   */
  private finalizePendingParts(): MessagePart[] {
    const completedParts: MessagePart[] = [];

    for (const [, textPart] of this.activeTextParts) {
      textPart.state = "done";
      completedParts.push(textPart);
    }
    this.activeTextParts.clear();

    for (const [, reasoningPart] of this.activeReasoningParts) {
      reasoningPart.state = "done";
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
      completedParts.push(toolCall.part as DynamicToolUIPart);
    }
    this.toolCalls.clear();

    return completedParts;
  }

  /**
   * Get the accumulated message.
   * Should only be called after process() returns true.
   */
  getMessage(): UIMessage | null {
    if (!this.finished) return null;

    return {
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
    this.finalizePendingParts();
    this.metadata = { ...((this.metadata as Record<string, unknown>) ?? {}), aborted: true };
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
