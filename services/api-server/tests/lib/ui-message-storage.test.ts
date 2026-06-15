import { describe, expect, it } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import { MessageRepository } from "../../src/modules/session-agent/repositories/message.repository";
import { PendingChunkRepository } from "../../src/modules/session-agent/repositories/pending-chunk.repository";
import type { SqlFn } from "../../src/modules/session-agent/repositories/repository.types";

function createSql(returnRows: unknown[] = []) {
  const calls: Array<{ query: string; values: Array<string | number | boolean | null> }> = [];
  const sql = ((
    strings: TemplateStringsArray,
    ...values: Array<string | number | boolean | null>
  ) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return returnRows;
  }) as SqlFn;

  return { calls, sql };
}

describe("UI message storage", () => {
  it("stores messages as raw AI SDK UI JSON with additive fields preserved", () => {
    const { calls, sql } = createSql();
    const repository = new MessageRepository(sql);
    const message = {
      id: "message-1",
      role: "assistant",
      parts: [{ type: "text", text: "hello", futurePartField: true }],
      futureMessageField: { nested: true },
    } as UIMessage;

    repository.create("session-1", message);

    const storedMessage = JSON.parse(calls[0]?.values[2] as string) as Record<string, unknown>;
    expect(storedMessage.futureMessageField).toEqual({ nested: true });
    expect(storedMessage.parts).toEqual([
      { type: "text", text: "hello", futurePartField: true },
    ]);
  });

  it("stores pending chunks as raw AI SDK UI JSON with additive fields preserved", () => {
    const { calls, sql } = createSql([{ sequence: 1 }]);
    const repository = new PendingChunkRepository(sql);
    const chunk = {
      type: "text-delta",
      id: "text-1",
      delta: "hello",
      futureChunkField: true,
    } as UIMessageChunk;

    expect(repository.appendIfNew(chunk, 1)).toBe(true);

    expect(JSON.parse(calls[0]?.values[1] as string)).toEqual(chunk);
  });
});
