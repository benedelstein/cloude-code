import { z } from "zod/v4";
import { WireUIMessagePartSchema, type WireUIMessagePart } from "./parts";

export type WireUIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: WireUIMessagePart[];
  metadata?: unknown;
};

export const WireUIMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(WireUIMessagePartSchema),
  metadata: z.unknown().optional(),
}) as z.ZodType<WireUIMessage>;
