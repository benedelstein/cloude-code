export class SpritesError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public responseBody?: string
    ) {
        super(message);
        this.name = "SpritesError";
    }
}


export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface SessionOptions {
    cwd?: string;
    env?: Record<string, string>;
    tty?: boolean;
}

// Server message types from Sprites exec WebSocket

import { z } from "zod";

export const SessionInfoMessageSchema = z.object({
    type: z.literal("session_info"),
    session_id: z.coerce.number(),
    command: z.string(),
    created: z.number(),
    cols: z.number().optional(),
    rows: z.number().optional(),
    is_owner: z.boolean(),
    tty: z.boolean(),
});

export const ExitMessageSchema = z.object({
    type: z.literal("exit"),
    exit_code: z.number(),
});

export const PortNotificationMessageSchema = z.object({
    type: z.enum(["port_opened", "port_closed"]),
    port: z.number(),
    address: z.string(),
    pid: z.number(),
});

export const SpriteServerMessageSchema = z.discriminatedUnion("type", [
    SessionInfoMessageSchema,
    ExitMessageSchema,
    PortNotificationMessageSchema,
]);

export type SessionInfoMessage = z.infer<typeof SessionInfoMessageSchema>;
export type ExitMessage = z.infer<typeof ExitMessageSchema>;
export type PortNotificationMessage = z.infer<typeof PortNotificationMessageSchema>;
export type SpriteServerMessage = z.infer<typeof SpriteServerMessageSchema>;