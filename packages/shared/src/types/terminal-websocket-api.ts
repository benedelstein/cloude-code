import { z } from "zod";

// ============================================================
// Session terminal WebSocket protocol (browser <-> api-server)
//
// The api-server relays a browser WebSocket to a Sprites exec
// session running a TTY shell on the session's VM.
//
// Frame rules:
// - server -> client PTY output is sent as BINARY frames (UTF-8 bytes).
// - server -> client control messages are JSON text frames.
// - client -> server messages are JSON text frames only.
// ============================================================

/** Client -> server control messages for the session terminal socket. */
export const TerminalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    /** Raw input data for the PTY (keystrokes, pastes). */
    data: z.string(),
  }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
]);

export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;

/** Server -> client control messages for the session terminal socket. */
export const TerminalServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("exit"),
    exitCode: z.number().int(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
  }),
]);

export type TerminalServerMessage = z.infer<typeof TerminalServerMessageSchema>;
