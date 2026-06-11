import { TerminalClientMessageSchema, type TerminalServerMessage } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";
import type { SpriteWebsocketSession } from "@/shared/integrations/sprites/SpriteWebsocketSession";
import type { Env } from "@/shared/types";
import { SPRITE_WORKSPACE_DIR } from "../utils/sprite-workspace.utils";

const logger = createLogger("session-terminal-relay.service.ts");

const textEncoder = new TextEncoder();

/**
 * Bound on how long a detached terminal shell keeps running on the sprite.
 * TTY exec sessions survive disconnect forever by default; this caps abandoned
 * shells so they stop keeping the sprite awake.
 */
const TERMINAL_MAX_RUN_AFTER_DISCONNECT = "10m";

export interface OpenSessionTerminalInput {
  env: Env;
  sessionId: string;
  spriteName: string;
  /** Persisted sprite exec-session id of a previous shell, or null to spawn fresh. */
  terminalSessionId: number | null;
  /** Persists (or clears) the sprite exec-session id for future re-attach. */
  persistTerminalSessionId: (terminalSessionId: number | null) => void;
  cols?: number;
  rows?: number;
}

/**
 * Opens a browser-facing WebSocket that relays a TTY shell on the session's
 * Sprite VM. Re-attaches to a persisted shell session when one is alive,
 * otherwise spawns a fresh detachable shell in the workspace directory.
 *
 * Returns a 101 upgrade response on success or a 502 JSON response when the
 * sprite connection cannot be established.
 */
export async function openSessionTerminal(input: OpenSessionTerminalInput): Promise<Response> {
  const sprite = new WorkersSpriteClient(
    input.spriteName,
    input.env.SPRITES_API_KEY,
    input.env.SPRITES_API_URL,
  );

  const pair = new WebSocketPair();
  const browserSocket = pair[1];
  browserSocket.accept();

  const spriteSession = await connectSpriteSession(sprite, input, browserSocket);
  if (!spriteSession) {
    return Response.json({ code: "SPRITE_CONNECT_FAILED" }, { status: 502 });
  }

  wireBrowserToSprite(browserSocket, spriteSession, input.sessionId);

  return new Response(null, { status: 101, webSocket: pair[0] });
}

/**
 * Attach-first connect: try the persisted session id, fall back to spawning a
 * fresh shell. Sprite-to-browser handlers are wired before start() so no early
 * output (including attach scrollback replay) is lost.
 */
async function connectSpriteSession(
  sprite: WorkersSpriteClient,
  input: OpenSessionTerminalInput,
  browserSocket: WebSocket,
): Promise<SpriteWebsocketSession | null> {
  if (input.terminalSessionId !== null) {
    const attachSession = sprite.attachSession(String(input.terminalSessionId), {
      replayHistoricalOutput: true,
    });
    wireSpriteToBrowser(attachSession, browserSocket, input);
    try {
      await attachSession.start();
      logger.info("Re-attached terminal session", {
        fields: { sessionId: input.sessionId, terminalSessionId: input.terminalSessionId },
      });
      return attachSession;
    } catch (error) {
      // Session was reaped (past disconnect window) or the sprite restarted.
      logger.info("Terminal re-attach failed, spawning fresh shell", {
        fields: { sessionId: input.sessionId, terminalSessionId: input.terminalSessionId },
        error,
      });
      input.persistTerminalSessionId(null);
    }
  }

  const execSession = sprite.createSession("bash", ["-il"], {
    tty: true,
    detachable: true,
    maxRunAfterDisconnect: TERMINAL_MAX_RUN_AFTER_DISCONNECT,
    cwd: SPRITE_WORKSPACE_DIR,
    cols: input.cols,
    rows: input.rows,
    // No `env`: the exec API replaces the default environment when env is set.
  });
  execSession.onServerMessage((message) => {
    if (message.type === "session_info") {
      input.persistTerminalSessionId(message.session_id);
    }
  });
  wireSpriteToBrowser(execSession, browserSocket, input);
  try {
    await execSession.start();
    logger.info("Spawned terminal shell", { fields: { sessionId: input.sessionId } });
    return execSession;
  } catch (error) {
    logger.error("Failed to spawn terminal shell", {
      fields: { sessionId: input.sessionId, spriteName: input.spriteName },
      error,
    });
    return null;
  }
}

function wireSpriteToBrowser(
  spriteSession: SpriteWebsocketSession,
  browserSocket: WebSocket,
  input: Pick<OpenSessionTerminalInput, "sessionId" | "persistTerminalSessionId">,
): void {
  spriteSession.onStdout((data) => {
    try {
      browserSocket.send(textEncoder.encode(data));
    } catch {
      // Browser socket already closed; its close handler tears down the relay.
    }
  });

  spriteSession.onExit((exitCode) => {
    // The shell process is gone; clear the persisted id so the next connect spawns fresh.
    input.persistTerminalSessionId(null);
    sendControlMessage(browserSocket, { type: "exit", exitCode });
    closeQuietly(browserSocket, 1000);
  });

  spriteSession.onError(() => {
    // Keep the persisted id: the shell may still be alive on the sprite and
    // the next connect can re-attach.
    closeQuietly(browserSocket, 1011);
  });
}

function wireBrowserToSprite(
  browserSocket: WebSocket,
  spriteSession: SpriteWebsocketSession,
  sessionId: string,
): void {
  browserSocket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = TerminalClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      logger.warn("Invalid terminal client message", { fields: { sessionId } });
      return;
    }

    try {
      switch (parsed.data.type) {
        case "input":
          spriteSession.write(parsed.data.data);
          break;
        case "resize":
          spriteSession.resize(parsed.data.cols, parsed.data.rows);
          break;
        default: {
          const exhaustiveCheck: never = parsed.data;
          throw new Error(`Unhandled terminal message: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    } catch (error) {
      logger.warn("Failed to forward terminal message to sprite", { fields: { sessionId }, error });
      closeQuietly(browserSocket, 1011);
    }
  });

  const teardown = () => {
    // Detach from the sprite session; the shell keeps running on the sprite
    // for the disconnect window so the user can re-attach.
    spriteSession.close();
  };
  browserSocket.addEventListener("close", teardown);
  browserSocket.addEventListener("error", teardown);
}

function sendControlMessage(socket: WebSocket, message: TerminalServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // Socket already closed.
  }
}

function closeQuietly(socket: WebSocket, code: number): void {
  try {
    socket.close(code);
  } catch {
    // Socket already closed.
  }
}
