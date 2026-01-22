import { Hono } from "hono";
import type { Env } from "../types";
import { WorkersSprite } from "../lib/sprites/WorkersSprite";

const testRoutes = new Hono<{ Bindings: Env }>();

/**
 * Interactive WebSocket test for WorkersSprite.createSession()
 *
 * This creates a WebSocket endpoint that proxies to a sprite shell session.
 * Connect with wscat or a WebSocket client:
 *
 *   wscat -c "ws://localhost:8787/test/interactive?sprite=test-1234"
 *
 * Then type commands and see output in real-time.
 */
testRoutes.get("/interactive", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.json(
      {
        error: "Expected WebSocket upgrade",
        usage: 'wscat -c "ws://localhost:8787/test/interactive?sprite=YOUR_SPRITE_NAME"',
      },
      426
    );
  }

  const spriteName = c.req.query("sprite");
  const command = c.req.query("cmd") ?? "/bin/bash";
  const cwd = c.req.query("cwd") ?? "/home/sprite";

  if (!spriteName) {
    return c.json({ error: "sprite query param required" }, 400);
  }

  const apiKey = c.env.SPRITES_API_KEY;
  const baseUrl = c.env.SPRITES_API_URL ?? "https://api.sprites.dev";
  if (!apiKey) {
    console.error(`[test/interactive] Missing SPRITES_API_KEY environment variable`);
    return c.json({ error: "missing SPRITES_API_KEY environment variable" }, 400);
  }

  console.log(`[test/interactive] Creating interactive session on sprite: ${spriteName}`);
  console.log(`[test/interactive] Command: ${command}, CWD: ${cwd}`);

  // Create WebSocket pair for client connection
  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];

  server.accept();

  // Create sprite session
  const sprite = new WorkersSprite(spriteName, apiKey, baseUrl);
  const spriteSession = sprite.createSession(command, [], { cwd, tty: true });

  // Wire up sprite -> client
  spriteSession.onStdout((data) => {
    console.log(`[sprite->client stdout] ${data.length} bytes`);
    server.send(JSON.stringify({ type: "stdout", data }));
  });

  spriteSession.onStderr((data) => {
    console.log(`[sprite->client stderr] ${data.length} bytes`);
    server.send(JSON.stringify({ type: "stderr", data }));
  });

  spriteSession.onExit((code) => {
    console.log(`[sprite] exit code: ${code}`);
    server.send(JSON.stringify({ type: "exit", code }));
    server.close(1000, "Process exited");
  });

  spriteSession.onError((err) => {
    console.error(`[sprite] error: ${err.message}`);
    server.send(JSON.stringify({ type: "error", message: err.message }));
  });

  // Wire up client -> sprite
  server.addEventListener("message", (event) => {
    const data = event.data;
    console.log(`[client->sprite] ${typeof data === "string" ? data.length : "binary"} bytes`);

    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "stdin" && msg.data) {
          spriteSession.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          // TODO: implement resize if needed
          console.log(`[resize] ${msg.cols}x${msg.rows} (not implemented)`);
        }
      } catch {
        // Treat as raw stdin
        spriteSession.write(data);
      }
    }
  });

  server.addEventListener("close", () => {
    console.log(`[test/interactive] Client disconnected`);
    try {
      spriteSession.close();
    } catch (e) {
      console.error(`[test/interactive] Error closing sprite session:`, e);
    }
  });

  // Start the sprite session
  try {
    await spriteSession.start();
    console.log(`[test/interactive] Sprite session started`);
    server.send(JSON.stringify({ type: "connected", sprite: spriteName, command, cwd }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[test/interactive] Failed to start sprite session: ${error}`);
    server.send(JSON.stringify({ type: "error", message: error }));
    server.close(1011, "Failed to connect to sprite");
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

/**
 * Simple non-interactive test for WorkersSprite.createSession()
 *
 * Usage:
 *   curl "http://localhost:8787/test/ws-session?sprite=test-1234&cmd=ls"
 */
testRoutes.get("/ws-session", async (c) => {
  const spriteName = c.req.query("sprite");
  const command = c.req.query("cmd") ?? "ls";
  const argsParam = c.req.query("args");
  const args = argsParam ? argsParam.split(",") : [];
  const cwd = c.req.query("cwd") ?? "/home/sprite";

  if (!spriteName) {
    return c.json({ error: "sprite query param required" }, 400);
  }

  const apiKey = c.env.SPRITES_API_KEY;
  const baseUrl = c.env.SPRITES_API_URL ?? "https://api.sprites.dev";

  console.log(`[test/ws-session] Creating session on sprite: ${spriteName}`);
  console.log(`[test/ws-session] Command: ${command} ${args.join(" ")}`);
  console.log(`[test/ws-session] CWD: ${cwd}`);

  const sprite = new WorkersSprite(spriteName, apiKey, baseUrl);
  const session = sprite.createSession(command, args, { cwd, tty: false });

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  session.onStdout((data) => {
    console.log(`[stdout] ${data}`);
    stdout += data;
  });

  session.onStderr((data) => {
    console.log(`[stderr] ${data}`);
    stderr += data;
  });

  session.onExit((code) => {
    console.log(`[exit] ${code}`);
    exitCode = code;
  });

  session.onError((err) => {
    console.error(`[error] ${err.message}`);
  });

  try {
    await session.start();
    console.log(`[test/ws-session] WebSocket connected`);

    // For non-interactive commands, wait for exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`[test/ws-session] Timeout - closing session`);
        session.close();
        resolve();
      }, 5000);

      session.onExit(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    return c.json({
      success: true,
      spriteName,
      command,
      args,
      cwd,
      stdout,
      stderr,
      exitCode,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[test/ws-session] Error: ${error}`);
    return c.json({ error }, 500);
  }
});

/**
 * Test WorkersSprite.execHttp() - HTTP-based exec (simpler)
 */
testRoutes.get("/http-exec", async (c) => {
  const spriteName = c.req.query("sprite");
  const command = c.req.query("cmd") ?? "echo hello";

  if (!spriteName) {
    return c.json({ error: "sprite query param required" }, 400);
  }

  const apiKey = c.env.SPRITES_API_KEY;
  const baseUrl = c.env.SPRITES_API_URL ?? "https://api.sprites.dev";

  console.log(`[test/http-exec] Executing on sprite: ${spriteName}`);
  console.log(`[test/http-exec] Command: ${command}`);

  const sprite = new WorkersSprite(spriteName, apiKey, baseUrl);

  try {
    const result = await sprite.execHttp(command);
    return c.json({
      success: true,
      spriteName,
      command,
      ...result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[test/http-exec] Error: ${error}`);
    return c.json({ error }, 500);
  }
});

export { testRoutes };
