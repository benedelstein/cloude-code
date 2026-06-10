import { z } from "zod";

export const VoiceTranscriptionTokenResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int().positive(),
});
export type VoiceTranscriptionTokenResponse = z.infer<
  typeof VoiceTranscriptionTokenResponse
>;

export const VoiceTranscriptionResponse = z.object({
  text: z.string(),
});
export type VoiceTranscriptionResponse = z.infer<
  typeof VoiceTranscriptionResponse
>;
