import type { UIMessage, UIMessageChunk } from "ai";
import type { Logger } from "@repo/shared";
import { createLogger } from "./logger";

type MessageParts = UIMessage["parts"];
type MessagePart = MessageParts[number];

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
 */
export class MessageAccumulator {
  private readonly logger: Logger = createLogger("MessageAccumulator");
  private messageId: string | undefined = undefined;
  private parts: MessageParts = [];
  private metadata: unknown = undefined;
  private finished = false;
  private pendingChunks: UIMessageChunk[] = [];

  // In-progress text accumulation
  private currentTextId: string | null = null;
  private currentText = "";

  // In-progress reasoning accumulation
  private currentReasoningId: string | null = null;
  private currentReasoning = "";

  // In-progress tool calls (keyed by toolCallId)
  private toolCalls = new Map<
    string,
    {
      toolName: string;
      inputText: string;
      input?: unknown;
      output?: unknown;
      state: string;
      title?: string;
      providerExecuted?: boolean;
    }
  >();

  /**
   * Process a stream chunk and accumulate it into the message.
   * @returns message completion state plus any parts fully materialized by this chunk
   */
  process(chunk: UIMessageChunk): ProcessChunkResult {
    this.pendingChunks.push(chunk);
    const completedParts: MessagePart[] = [];

    switch (chunk.type) {
      case "start":
        this.messageId = chunk.messageId;
        this.logger.debug(`start chunk, messageId=${chunk.messageId}`);
        break;

      case "text-start":
        this.currentTextId = chunk.id;
        this.currentText = "";
        break;

      case "text-delta":
        if (this.currentTextId === chunk.id) {
          this.currentText += chunk.delta;
        }
        break;

      case "text-end":
        if (this.currentTextId === chunk.id && this.currentText) {
          const messagePart = { type: "text", text: this.currentText, state: "done" } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
          this.currentTextId = null;
          this.currentText = "";
        }
        break;

      case "reasoning-start":
        this.currentReasoningId = chunk.id;
        this.currentReasoning = "";
        break;

      case "reasoning-delta":
        if (this.currentReasoningId === chunk.id) {
          this.currentReasoning += chunk.delta;
        }
        break;

      case "reasoning-end":
        if (this.currentReasoningId === chunk.id && this.currentReasoning) {
          const messagePart = { type: "reasoning", text: this.currentReasoning, state: "done" } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
          this.currentReasoningId = null;
          this.currentReasoning = "";
        }
        break;

      case "tool-input-start":
        this.toolCalls.set(chunk.toolCallId, {
          toolName: chunk.toolName,
          inputText: "",
          state: "input-streaming",
          title: chunk.title,
          providerExecuted: chunk.providerExecuted,
        });
        break;

      case "tool-input-delta": {
        const toolCall = this.toolCalls.get(chunk.toolCallId);
        if (toolCall) {
          toolCall.inputText += chunk.inputTextDelta;
        }
        break;
      }

      case "tool-input-available": {
        const availableTool = this.toolCalls.get(chunk.toolCallId);
        if (availableTool) {
          availableTool.input = chunk.input;
          availableTool.state = "input-available";
        } else {
          this.toolCalls.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            inputText: "",
            input: chunk.input,
            state: "input-available",
            title: chunk.title,
            providerExecuted: chunk.providerExecuted,
          });
        }
        break;
      }

      case "tool-output-available": {
        const outputTool = this.toolCalls.get(chunk.toolCallId);
        if (outputTool) {
          outputTool.output = chunk.output;
          outputTool.state = "output-available";
          const messagePart = {
            type: "dynamic-tool",
            toolName: outputTool.toolName,
            toolCallId: chunk.toolCallId,
            state: "output-available",
            input: outputTool.input,
            output: chunk.output,
            title: outputTool.title,
            providerExecuted: outputTool.providerExecuted,
          } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
          this.toolCalls.delete(chunk.toolCallId);
        }
        break;
      }

      case "tool-output-error": {
        const errorTool = this.toolCalls.get(chunk.toolCallId);
        if (errorTool) {
          const messagePart = {
            type: "dynamic-tool",
            toolName: errorTool.toolName,
            toolCallId: chunk.toolCallId,
            state: "output-error",
            input: errorTool.input,
            errorText: chunk.errorText,
            title: errorTool.title,
            providerExecuted: errorTool.providerExecuted,
          } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
          this.toolCalls.delete(chunk.toolCallId);
        }
        break;
      }

      case "source-url":
        {
          const messagePart = {
          type: "source-url",
          sourceId: chunk.sourceId,
          url: chunk.url,
          title: chunk.title,
          providerMetadata: chunk.providerMetadata,
          } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
        }
        break;

      case "source-document":
        {
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
        }
        break;

      case "file":
        {
          const messagePart = {
          type: "file",
          mediaType: chunk.mediaType,
          url: chunk.url,
          providerMetadata: chunk.providerMetadata,
          } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
        }
        break;

      case "start-step":
        {
          const messagePart = { type: "step-start" } as MessagePart;
          this.parts.push(messagePart);
          completedParts.push(messagePart);
        }
        break;

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

  private finalizePendingParts(): MessagePart[] {
    const completedParts: MessagePart[] = [];

    if (this.currentText) {
      const messagePart = { type: "text", text: this.currentText, state: "done" } as MessagePart;
      this.parts.push(messagePart);
      completedParts.push(messagePart);
      this.currentText = "";
      this.currentTextId = null;
    }

    if (this.currentReasoning) {
      const messagePart = { type: "reasoning", text: this.currentReasoning, state: "done" } as MessagePart;
      this.parts.push(messagePart);
      completedParts.push(messagePart);
      this.currentReasoning = "";
      this.currentReasoningId = null;
    }

    for (const [toolCallId, tool] of this.toolCalls) {
      let input = tool.input;
      if (!input && tool.inputText) {
        try {
          input = JSON.parse(tool.inputText);
        } catch {
          input = tool.inputText;
        }
      }

      const messagePart = {
        type: "dynamic-tool",
        toolName: tool.toolName,
        toolCallId,
        state: tool.state,
        input,
        ...(tool.output !== undefined && { output: tool.output }),
        title: tool.title,
        providerExecuted: tool.providerExecuted,
      } as MessagePart;
      this.parts.push(messagePart);
      completedParts.push(messagePart);
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
    // If no content was accumulated there is nothing worth saving
    if (this.parts.length === 0 && !this.currentText && !this.currentReasoning && this.toolCalls.size === 0) {
      return null;
    }
    // messageId is optional on the "start" chunk — fall back to a generated id
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
    this.currentTextId = null;
    this.currentText = "";
    this.currentReasoningId = null;
    this.currentReasoning = "";
    this.toolCalls.clear();
  }
}
