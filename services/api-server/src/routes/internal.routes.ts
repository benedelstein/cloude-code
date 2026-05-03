import { Hono } from "hono";
import { getAgentByName } from "agents";
import { AgentEvent } from "@repo/shared";
import { z } from "zod";
import type { UIMessageChunk } from "ai";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { createLogger } from "@/lib/logger";

/**
 * Internal webhook routes called by the vm-agent process running on the
 * sprite. Each route authenticates with a per-session bearer token, then
 * forwards into the owning DO.
 *
 * Traffic shape:
 *   POST /internal/session/:sessionId/chunks
 *     Body: { userMessageId: string, chunks: [{ sequence, chunk }, ...] }
 *   POST /internal/session/:sessionId/events
 *     Body: { event: AgentEvent }
 */
export const internalRoutes = new Hono<{ Bindings: Env }>();
const logger = createLogger("internal.routes.ts");

const ChunkItemSchema = z.object({
  sequence: z.number(),
  chunk: z.unknown(),
});

const ChunksBodySchema = z.object({
  userMessageId: z.string().min(1),
  chunks: z.array(ChunkItemSchema),
});

const EventBodySchema = z.object({
  event: AgentEvent,
});

function parseBearerToken(auth: string | undefined): string | null {
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

async function verifyWebhookAuth(
  env: Env,
  sessionId: string,
  auth: string | undefined,
): Promise<
  | { ok: true; stub: DurableObjectStub<SessionAgentDO> }
  | { ok: false; status: 401 | 403 | 500; message: string }
> {
  const token = parseBearerToken(auth);
  if (!token) {
    return { ok: false, status: 401, message: "Missing bearer token" };
  }
  const stub = await getAgentByName<Env, SessionAgentDO>(
    env.SESSION_AGENT,
    sessionId,
  );
  const valid = await stub.verifyWebhookToken(token);
  if (!valid) {
    return { ok: false, status: 403, message: "Invalid webhook token" };
  }
  return { ok: true, stub };
}

internalRoutes.post("/session/:sessionId/chunks", async (c) => {
  const sessionId = c.req.param("sessionId");
  logger.info("[/chunks] incoming webhook", { fields: { sessionId } });
  // TODO: why are we doing 2 rpcs here.
  const authResult = await verifyWebhookAuth(
    c.env,
    sessionId,
    c.req.header("authorization"),
  );
  if (!authResult.ok) {
    logger.warn("[/chunks] auth failed", {
      fields: { sessionId, status: authResult.status, reason: authResult.message },
    });
    return c.json({ error: authResult.message }, authResult.status);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    logger.warn("Invalid JSON in /chunks webhook", {
      error,
      fields: { sessionId },
    });
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = ChunksBodySchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("[/chunks] invalid body", {
      fields: {
        sessionId,
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return c.json(
      {
        error: "Invalid body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  }

  const chunks = parsed.data.chunks.map((item) => ({
    sequence: item.sequence,
    chunk: item.chunk as UIMessageChunk,
  }));
  logger.info("[/chunks] forwarding to DO", {
    fields: {
      sessionId,
      userMessageId: parsed.data.userMessageId,
      chunkCount: chunks.length,
      firstSeq: chunks[0]?.sequence ?? -1,
      lastSeq: chunks[chunks.length - 1]?.sequence ?? -1,
      types: chunks
        .map((c) => (c.chunk as { type?: string } | null)?.type ?? "unknown")
        .join(","),
    },
  });
  await authResult.stub.handleWebhookChunks(parsed.data.userMessageId, chunks);
  return new Response(null, { status: 204 });
});

internalRoutes.post("/session/:sessionId/events", async (c) => {
  const sessionId = c.req.param("sessionId");
  logger.info("[/events] incoming webhook", { fields: { sessionId } });
  const authResult = await verifyWebhookAuth(
    c.env,
    sessionId,
    c.req.header("authorization"),
  );
  if (!authResult.ok) {
    logger.warn("[/events] auth failed", {
      fields: { sessionId, status: authResult.status, reason: authResult.message },
    });
    return c.json({ error: authResult.message }, authResult.status);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    logger.warn("Invalid JSON in /events webhook", {
      error,
      fields: { sessionId },
    });
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = EventBodySchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("[/events] invalid body", {
      fields: {
        sessionId,
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return c.json(
      {
        error: "Invalid body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  }

  logger.info("[/events] forwarding to DO", {
    fields: { sessionId, eventType: parsed.data.event.type },
  });
  await authResult.stub.handleWebhookEvent(parsed.data.event);
  return new Response(null, { status: 204 });
});
