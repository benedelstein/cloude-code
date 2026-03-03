import type { UIMessage, UIMessageChunk } from "ai";

type MessageParts = UIMessage["parts"];
type MessagePart = MessageParts[number];

/**
 * Accumulates UIMessageStream chunks into a complete UIMessage.
 * Used by the DO to build the final message for storage while streaming parts to clients.
 */
export class MessageAccumulator {
  private messageId: string | undefined = undefined;
  private parts: MessageParts = [];
  private metadata: unknown = undefined;
  private finished = false;

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
   * @returns true if the message is now complete (finish received)
   */
  process(chunk: unknown): boolean {
    const part = chunk as UIMessageChunk;

    switch (part.type) {
      case "start":
        this.messageId = part.messageId;
        break;

      case "text-start":
        this.currentTextId = part.id;
        this.currentText = "";
        break;

      case "text-delta":
        if (this.currentTextId === part.id) {
          this.currentText += part.delta;
        }
        break;

      case "text-end":
        if (this.currentTextId === part.id && this.currentText) {
          this.parts.push({ type: "text", text: this.currentText, state: "done" } as MessagePart);
          this.currentTextId = null;
          this.currentText = "";
        }
        break;

      case "reasoning-start":
        this.currentReasoningId = part.id;
        this.currentReasoning = "";
        break;

      case "reasoning-delta":
        if (this.currentReasoningId === part.id) {
          this.currentReasoning += part.delta;
        }
        break;

      case "reasoning-end":
        if (this.currentReasoningId === part.id && this.currentReasoning) {
          this.parts.push({ type: "reasoning", text: this.currentReasoning, state: "done" } as MessagePart);
          this.currentReasoningId = null;
          this.currentReasoning = "";
        }
        break;

      case "tool-input-start":
        this.toolCalls.set(part.toolCallId, {
          toolName: part.toolName,
          inputText: "",
          state: "input-streaming",
          title: part.title,
          providerExecuted: part.providerExecuted,
        });
        break;

      case "tool-input-delta": {
        const toolCall = this.toolCalls.get(part.toolCallId);
        if (toolCall) {
          toolCall.inputText += part.inputTextDelta;
        }
        break;
      }

      case "tool-input-available": {
        const availableTool = this.toolCalls.get(part.toolCallId);
        if (availableTool) {
          availableTool.input = part.input;
          availableTool.state = "input-available";
        } else {
          this.toolCalls.set(part.toolCallId, {
            toolName: part.toolName,
            inputText: "",
            input: part.input,
            state: "input-available",
            title: part.title,
            providerExecuted: part.providerExecuted,
          });
        }
        break;
      }

      case "tool-output-available": {
        const outputTool = this.toolCalls.get(part.toolCallId);
        if (outputTool) {
          outputTool.output = part.output;
          outputTool.state = "output-available";
          this.parts.push({
            type: "dynamic-tool",
            toolName: outputTool.toolName,
            toolCallId: part.toolCallId,
            state: "output-available",
            input: outputTool.input,
            output: part.output,
            title: outputTool.title,
            providerExecuted: outputTool.providerExecuted,
          } as MessagePart);
          this.toolCalls.delete(part.toolCallId);
        }
        break;
      }

      case "tool-output-error": {
        const errorTool = this.toolCalls.get(part.toolCallId);
        if (errorTool) {
          this.parts.push({
            type: "dynamic-tool",
            toolName: errorTool.toolName,
            toolCallId: part.toolCallId,
            state: "output-error",
            input: errorTool.input,
            errorText: part.errorText,
            title: errorTool.title,
            providerExecuted: errorTool.providerExecuted,
          } as MessagePart);
          this.toolCalls.delete(part.toolCallId);
        }
        break;
      }

      case "source-url":
        this.parts.push({
          type: "source-url",
          sourceId: part.sourceId,
          url: part.url,
          title: part.title,
          providerMetadata: part.providerMetadata,
        } as MessagePart);
        break;

      case "source-document":
        this.parts.push({
          type: "source-document",
          sourceId: part.sourceId,
          mediaType: part.mediaType,
          title: part.title,
          filename: part.filename,
          providerMetadata: part.providerMetadata,
        } as MessagePart);
        break;

      case "file":
        this.parts.push({
          type: "file",
          mediaType: part.mediaType,
          url: part.url,
          providerMetadata: part.providerMetadata,
        } as MessagePart);
        break;

      case "start-step":
        this.parts.push({ type: "step-start" } as MessagePart);
        break;

      case "finish":
        this.finalizePendingParts();
        this.metadata = part.messageMetadata;
        this.finished = true;
        return true;

      case "finish-step":
        break;

      case "abort":
        this.finalizePendingParts();
        this.metadata = { ...((this.metadata as Record<string, unknown>) ?? {}), aborted: true };
        this.finished = true;
        return true;

      case "error":
        this.finalizePendingParts();
        this.finished = true;
        return true;
    }

    return false;
  }

  private finalizePendingParts(): void {
    if (this.currentText) {
      this.parts.push({ type: "text", text: this.currentText, state: "done" } as MessagePart);
      this.currentText = "";
      this.currentTextId = null;
    }

    if (this.currentReasoning) {
      this.parts.push({ type: "reasoning", text: this.currentReasoning, state: "done" } as MessagePart);
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

      this.parts.push({
        type: "dynamic-tool",
        toolName: tool.toolName,
        toolCallId,
        state: tool.state,
        input,
        ...(tool.output !== undefined && { output: tool.output }),
        title: tool.title,
        providerExecuted: tool.providerExecuted,
      } as MessagePart);
    }
    this.toolCalls.clear();
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

  reset(): void {
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
