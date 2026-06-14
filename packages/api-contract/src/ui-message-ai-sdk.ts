import type {
  UIMessage as AIUIMessage,
  UIMessageChunk as AIUIMessageChunk,
} from "ai";
import {
  UI_MESSAGE_CHUNK_OPEN_UNION,
  UIMessageChunkSchema,
  type UIMessageChunk,
} from "./ui-message-chunks";
import { UIMessageSchema, type UIMessage } from "./ui-message";
import {
  UI_MESSAGE_PART_OPEN_UNION,
  type UIMessagePart,
} from "./ui-message-parts";

export function fromAIUIMessage(message: AIUIMessage): UIMessage {
  return UIMessageSchema.parse(message);
}

export function fromAIUIMessageChunk(chunk: AIUIMessageChunk): UIMessageChunk {
  return UIMessageChunkSchema.parse(chunk);
}

export function toAIUIMessage(message: UIMessage): AIUIMessage {
  return {
    ...message,
    parts: message.parts.filter(isKnownUIMessagePart),
  } as AIUIMessage;
}

export function toAIUIMessageChunk(chunk: UIMessageChunk): AIUIMessageChunk | undefined {
  return isKnownUIMessageChunk(chunk) ? (chunk as AIUIMessageChunk) : undefined;
}

function isKnownUIMessagePart(part: UIMessagePart): boolean {
  return isKnownDiscriminator(part.type, UI_MESSAGE_PART_OPEN_UNION);
}

function isKnownUIMessageChunk(chunk: UIMessageChunk): boolean {
  return isKnownDiscriminator(chunk.type, UI_MESSAGE_CHUNK_OPEN_UNION);
}

function isKnownDiscriminator(
  discriminator: string,
  union: {
    exactCases: Array<{ discriminatorValue: string }>;
    prefixCases: Array<{ prefix: string }>;
  },
): boolean {
  return (
    union.exactCases.some((entry) => entry.discriminatorValue === discriminator) ||
    union.prefixCases.some((entry) => discriminator.startsWith(entry.prefix))
  );
}
