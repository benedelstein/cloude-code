import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@/types";
import { WorkersSpriteClient } from "@/lib/sprites";
import { createLogger } from "@/lib/logger";

const logger = createLogger("debug.routes.ts");

const debugExecWsRequestSchema = z.object({
  spriteName: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  idleTimeoutMs: z.number().positive().optional(),
});

export const debugRoutes = new Hono<{ Bindings: Env }>();

debugRoutes.use("*", async (c, next) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.notFound();
  }

  await next();
});

debugRoutes.post("/sprites-exec-ws", async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const result = debugExecWsRequestSchema.safeParse(rawBody);

  if (!result.success) {
    return c.json(
      {
        error: "Invalid request body",
        details: result.error.flatten(),
      },
      400,
    );
  }

  const request = result.data;
  const sprite = new WorkersSpriteClient(
    request.spriteName,
    c.env.SPRITES_API_KEY,
    c.env.SPRITES_API_URL,
  );

  try {
    const result = await sprite.execWs(request.command, {
      cwd: request.cwd,
      env: request.env,
      idleTimeoutMs: request.idleTimeoutMs,
    });

    return c.json({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown websocket exec error";
    logger.error(`Debug websocket exec failed: ${message}`);

    return c.json(
      {
        error: message,
      },
      502,
    );
  }
});
