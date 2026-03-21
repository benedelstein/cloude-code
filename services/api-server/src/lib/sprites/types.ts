export class SpritesError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public responseBody?: string
    ) {
        super(message);
        this.name = "SpritesError";
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}


export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface NewExecSessionOptions {
    cwd?: string;
    env?: Record<string, string>;
    tty?: boolean;
    cols?: number;
    rows?: number;
    detachable?: boolean;
}

export interface AttachSessionOptions {
    cwd?: string;
    env?: Record<string, string>;
    detachable?: boolean;
}

// Server message types from Sprites exec WebSocket

import { z } from "zod";

/**
 * This message is sent by the sprite - not controlled by us
 */
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

/**
 * This message is sent by the sprite - not controlled by us
 */
export const ExitMessageSchema = z.object({
    type: z.literal("exit"),
    exit_code: z.number(),
});

/**
 * This message is sent by the sprite - not controlled by us
 */
export const PortNotificationMessageSchema = z.object({
    type: z.enum(["port_opened", "port_closed"]),
    port: z.number(),
    address: z.string(),
    pid: z.number(),
});

export const DebugMessageSchema = z.object({
    type: z.literal("debug"),
    msg: z.string(),
    pid: z.number().optional(),
    t_ms: z.number().optional(),
});

export const SpriteServerMessageSchema = z.discriminatedUnion("type", [
    SessionInfoMessageSchema,
    ExitMessageSchema,
    PortNotificationMessageSchema,
    DebugMessageSchema,
]);

export type SessionInfoMessage = z.infer<typeof SessionInfoMessageSchema>;
export type ExitMessage = z.infer<typeof ExitMessageSchema>;
export type PortNotificationMessage = z.infer<typeof PortNotificationMessageSchema>;
export type SpriteServerMessage = z.infer<typeof SpriteServerMessageSchema>;
