import { WireUIMessageChunkSchema, type WireUIMessageChunk } from "./chunks";
import { WireUIMessageSchema, type WireUIMessage } from "./message";

export function validateWireCompatibleMessage(value: unknown): asserts value is WireUIMessage {
  const result = WireUIMessageSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Message is not wire-compatible: ${result.error.message}`);
  }
}

export function validateWireCompatibleChunk(value: unknown): asserts value is WireUIMessageChunk {
  // This parsing is tolerant of future fields, but requires that existing fields are covered.
  const result = WireUIMessageChunkSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Chunk is not wire-compatible: ${result.error.message}`);
  }
}
