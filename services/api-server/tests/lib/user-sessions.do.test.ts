import { afterEach, describe, expect, it, vi } from "vitest";
import { UserSessionsDO } from "../../src/runtime/user-sessions.do";
import type { Env } from "../../src/shared/types";
import { USER_SESSIONS_USER_ID_HEADER } from "../../src/shared/types/user-sessions";

const USER_ID = "123e4567-e89b-12d3-a456-426614174001";
const OTHER_USER_ID = "123e4567-e89b-12d3-a456-426614174002";
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174010";

class FakeResponse {
  public readonly status: number;
  public readonly webSocket?: unknown;

  constructor(
    public readonly body: BodyInit | null = null,
    init: ResponseInit & { webSocket?: unknown } = {},
  ) {
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
}

class FakeWebSocket {
  public readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }
}

class FakeWebSocketPair {
  public readonly 0 = new FakeWebSocket();
  public readonly 1 = new FakeWebSocket();
}

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
};

function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    repo_id: 42,
    installation_id: 99,
    repo_full_name: "owner/repo",
    title: "Sidebar work",
    archived: 0,
    access_blocked_at: null,
    access_block_reason: null,
    working_state: "responding",
    pushed_branch: "cloude/sidebar-abcd",
    pull_request_url: "https://github.com/owner/repo/pull/4",
    pull_request_number: 4,
    pull_request_state: "open",
    source_environment_id: null,
    source_environment_name: null,
    created_at: "2026-05-24 10:00:00",
    updated_at: "2026-05-24 10:01:00",
    last_message_at: "2026-05-24 10:02:00",
    ...overrides,
  };
}

function createMockDatabase(firstRow: unknown = null) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const database = {
    prepare(query: string): PreparedStatement {
      const call = { query, bindings: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.bindings = values;
          return this;
        },
        async first<T>() {
          return firstRow as T | null;
        },
      };
    },
  } as D1Database;

  return { calls, database };
}

function createStorage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));

  return {
    kv: {
      get<T>(key: string): T | undefined {
        return values.get(key) as T | undefined;
      },
      put(key: string, value: unknown): void {
        values.set(key, value);
      },
    },
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
}

function createContext(initialUserId?: string) {
  const webSockets: FakeWebSocket[] = [];
  return {
    storage: createStorage(initialUserId ? { userId: initialUserId } : {}),
    acceptWebSocket(webSocket: FakeWebSocket) {
      webSockets.push(webSocket);
    },
    getWebSockets() {
      return webSockets;
    },
    webSockets,
  };
}

function createDO(params: {
  firstRow?: unknown;
  initialUserId?: string;
  webSockets?: FakeWebSocket[];
} = {}) {
  const { calls, database } = createMockDatabase(params.firstRow ?? null);
  const context = createContext(params.initialUserId);
  for (const webSocket of params.webSockets ?? []) {
    context.webSockets.push(webSocket);
  }
  const env = {
    DB: database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "silent",
  } as unknown as Env;
  const durableObject = new UserSessionsDO(
    context as unknown as DurableObjectState,
    env,
  );

  return { calls, context, durableObject };
}

function parseSent(webSocket: FakeWebSocket, index = 0): unknown {
  return JSON.parse(webSocket.sent[index] ?? "null");
}

describe("UserSessionsDO", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a websocket connection and sends connected", async () => {
    vi.stubGlobal("Response", FakeResponse);
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
    const { context, durableObject } = createDO();

    const response = await durableObject.fetch(new Request("http://user-sessions/", {
      headers: {
        Upgrade: "websocket",
        [USER_SESSIONS_USER_ID_HEADER]: USER_ID,
      },
    }));

    expect(response.status).toBe(101);
    expect(context.webSockets).toHaveLength(1);
    expect(parseSent(context.webSockets[0]!)).toEqual({
      type: "user_sessions.connected",
    });
  });

  it("rejects non-root fetch paths", async () => {
    vi.stubGlobal("Response", FakeResponse);
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
    const { context, durableObject } = createDO();

    const response = await durableObject.fetch(new Request("http://user-sessions/updates", {
      headers: {
        Upgrade: "websocket",
        [USER_SESSIONS_USER_ID_HEADER]: USER_ID,
      },
    }));

    expect(response.status).toBe(404);
    expect(context.webSockets).toHaveLength(0);
  });

  it("fetches and broadcasts a full summary for invalidation", async () => {
    const webSocket = new FakeWebSocket();
    const { calls, durableObject } = createDO({
      firstRow: createSessionRow(),
      initialUserId: USER_ID,
      webSockets: [webSocket],
    });

    await durableObject.invalidateSessionSummary({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(calls[0]?.query).toContain("WHERE id = ? AND user_id = ?");
    expect(calls[0]?.bindings).toEqual([SESSION_ID, USER_ID]);
    expect(parseSent(webSocket)).toMatchObject({
      type: "session.summary.updated",
      session: {
        id: SESSION_ID,
        workingState: "responding",
        pushedBranch: "cloude/sidebar-abcd",
        pullRequest: { number: 4, state: "open" },
      },
    });
  });

  it("broadcasts removed when an invalidated summary is missing or archived", async () => {
    const missingSocket = new FakeWebSocket();
    const missing = createDO({
      firstRow: null,
      initialUserId: USER_ID,
      webSockets: [missingSocket],
    });

    await missing.durableObject.invalidateSessionSummary({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(parseSent(missingSocket)).toEqual({
      type: "session.summary.removed",
      sessionId: SESSION_ID,
    });

    const archivedSocket = new FakeWebSocket();
    const archived = createDO({
      firstRow: createSessionRow({ archived: 1 }),
      initialUserId: USER_ID,
      webSockets: [archivedSocket],
    });

    await archived.durableObject.invalidateSessionSummary({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(parseSent(archivedSocket)).toEqual({
      type: "session.summary.removed",
      sessionId: SESSION_ID,
    });
  });

  it("broadcasts explicit remove messages without fetching D1", async () => {
    const webSocket = new FakeWebSocket();
    const { calls, durableObject } = createDO({
      initialUserId: USER_ID,
      webSockets: [webSocket],
    });

    await durableObject.removeSessionSummary({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(calls).toHaveLength(0);
    expect(parseSent(webSocket)).toEqual({
      type: "session.summary.removed",
      sessionId: SESSION_ID,
    });
  });

  it("broadcasts resync requests without fetching D1", async () => {
    const webSocket = new FakeWebSocket();
    const { calls, durableObject } = createDO({
      initialUserId: USER_ID,
      webSockets: [webSocket],
    });

    await durableObject.requestResync({ userId: USER_ID });

    expect(calls).toHaveLength(0);
    expect(parseSent(webSocket)).toEqual({
      type: "session.list.resync_required",
    });
  });

  it("rejects RPC requests for a different user once scoped", async () => {
    const webSocket = new FakeWebSocket();
    const { durableObject } = createDO({
      initialUserId: USER_ID,
      webSockets: [webSocket],
    });

    await expect(durableObject.removeSessionSummary({
      userId: OTHER_USER_ID,
      sessionId: SESSION_ID,
    })).rejects.toThrow("User sessions Durable Object scoped to a different user");

    expect(webSocket.sent).toEqual([]);
  });

  it("rejects invalid RPC requests and invalid outbound messages", async () => {
    const webSocket = new FakeWebSocket();
    const { durableObject } = createDO({
      initialUserId: USER_ID,
      webSockets: [webSocket],
    });

    await expect(durableObject.removeSessionSummary({
      userId: USER_ID,
      sessionId: "not-a-uuid",
    })).rejects.toThrow("Invalid user sessions RPC session request");

    (durableObject as unknown as {
      broadcast(message: unknown): void;
    }).broadcast({
      type: "session.summary.updated",
      session: { id: SESSION_ID },
    });

    expect(webSocket.sent).toEqual([]);
  });
});
