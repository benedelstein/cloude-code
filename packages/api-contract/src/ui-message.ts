import { z } from "zod/v4";
import { UIMessagePartSchema, type WireUIMessagePart } from "./ui-message-parts";

export const UIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(UIMessagePartSchema),
  metadata: z.unknown().optional(),
});

export type WireUIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: WireUIMessagePart[];
  metadata?: unknown;
};
