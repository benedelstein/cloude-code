import type { UIMessage, UIMessageChunk } from "ai";
import {
  UI_MESSAGE_CHUNK_OPEN_UNION,
  type WireUIMessageChunk,
} from "./chunks";
import type { WireUIMessage } from "./message";
import {
  UI_MESSAGE_PART_OPEN_UNION,
  type WireUIMessagePart,
} from "./parts";
import {
  validateWireCompatibleChunk,
  validateWireCompatibleMessage,
} from "./wire-validation";

export function wireMessageFromAI(message: UIMessage): WireUIMessage {
  validateWireCompatibleMessage(message);
  return message;
}

export function wireChunkFromAI(chunk: UIMessageChunk): WireUIMessageChunk {
  validateWireCompatibleChunk(chunk);
  return chunk;
}

export function aiMessageFromWire(message: WireUIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.filter(isKnownUIMessagePart),
  } as UIMessage;
}

export function aiChunkFromWire(chunk: WireUIMessageChunk): UIMessageChunk | undefined {
  return isKnownUIMessageChunk(chunk) ? (chunk as UIMessageChunk) : undefined;
}

function isKnownUIMessagePart(part: WireUIMessagePart): boolean {
  return isKnownDiscriminator(part.type, UI_MESSAGE_PART_OPEN_UNION);
}

function isKnownUIMessageChunk(chunk: WireUIMessageChunk): boolean {
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
