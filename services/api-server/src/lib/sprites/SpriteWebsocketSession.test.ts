/**
 * Unit tests for SpriteWebsocketSession URL construction and message decoding.
 *
 * Run with: npx tsx --test services/api-server/src/lib/sprites/SpriteWebsocketSession.test.ts
 *
 * These tests validate the URL construction logic matches the upstream
 * sprites-js SDK (superfly/sprites-js exec.ts buildWebSocketURL).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { SpriteWebsocketSession } from "./SpriteWebsocketSession";

// Helper: extract the URL that would be built by start() without actually connecting.
// We access the private buildUrl via the static factories + a small cast trick.
function buildExecUrl(
  command: string,
  args: string[],
  options: Record<string, unknown> = {},
): URL {
  const session = SpriteWebsocketSession.createExec(
    "my-sprite",
    "test-token",
    "https://api.sprites.dev",
    command,
    args,
    options as any,
  );
  // Access private buildUrl for testing
  return (session as any).buildUrl();
}

function buildAttachUrl(sessionId: string, options: Record<string, unknown> = {}): URL {
  const session = SpriteWebsocketSession.createAttach(
    "my-sprite",
    "test-token",
    "https://api.sprites.dev",
    sessionId,
    options as any,
  );
  return (session as any).buildUrl();
}

// ============================================================
// URL Construction — Raw Exec Mode
// ============================================================

describe("URL Construction: raw exec mode", () => {
  it("should build correct URL for basic command", () => {
    const url = buildExecUrl("echo", ["hello"]);

    assert.strictEqual(url.pathname, "/v1/sprites/my-sprite/exec");
    assert.deepStrictEqual(url.searchParams.getAll("cmd"), ["echo", "hello"]);
    assert.strictEqual(url.searchParams.get("path"), "echo");
    assert.strictEqual(url.searchParams.get("stdin"), "true");
  });

  it("should include environment variables", () => {
    const url = buildExecUrl("env", [], {
      env: { FOO: "bar", BAZ: "qux" },
    });

    const envParams = url.searchParams.getAll("env");
    assert.ok(envParams.includes("FOO=bar"));
    assert.ok(envParams.includes("BAZ=qux"));
  });

  it("should include working directory as 'dir'", () => {
    const url = buildExecUrl("pwd", [], { cwd: "/workspace" });

    assert.strictEqual(url.searchParams.get("dir"), "/workspace");
  });

  it("should include TTY with rows and cols", () => {
    const url = buildExecUrl("bash", [], {
      tty: true,
      rows: 24,
      cols: 80,
    });

    assert.strictEqual(url.searchParams.get("tty"), "true");
    assert.strictEqual(url.searchParams.get("rows"), "24");
    assert.strictEqual(url.searchParams.get("cols"), "80");
  });

  it("should not include rows/cols when TTY is false", () => {
    const url = buildExecUrl("bash", [], {
      tty: false,
      rows: 24,
      cols: 80,
    });

    assert.strictEqual(url.searchParams.get("tty"), null);
    assert.strictEqual(url.searchParams.get("rows"), null);
    assert.strictEqual(url.searchParams.get("cols"), null);
  });

  it("should include detachable flag when set", () => {
    const url = buildExecUrl("bash", [], { detachable: true });

    assert.strictEqual(url.searchParams.get("detachable"), "true");
  });

  it("should not include detachable flag when not set", () => {
    const url = buildExecUrl("bash", []);

    assert.strictEqual(url.searchParams.get("detachable"), null);
  });

  it("should not include session id in URL or query params", () => {
    const url = buildExecUrl("echo", ["test"]);

    // exec mode should never have a session id in the path
    assert.ok(!url.pathname.includes("/exec/"));
    assert.strictEqual(url.searchParams.get("id"), null);
  });

  it("should always include stdin=true", () => {
    const url = buildExecUrl("echo", ["hello"]);
    assert.strictEqual(url.searchParams.get("stdin"), "true");
  });
});

// ============================================================
// URL Construction — Detachable Session Create
// ============================================================

describe("URL Construction: detachable session create", () => {
  it("should set both tty and detachable via WorkersSprite.createDetachableSession pattern", () => {
    // Simulate what WorkersSprite.createDetachableSession does
    const url = buildExecUrl("bash", [], {
      tty: true,
      detachable: true,
      rows: 40,
      cols: 120,
    });

    assert.strictEqual(url.pathname, "/v1/sprites/my-sprite/exec");
    assert.strictEqual(url.searchParams.get("tty"), "true");
    assert.strictEqual(url.searchParams.get("detachable"), "true");
    assert.strictEqual(url.searchParams.get("rows"), "40");
    assert.strictEqual(url.searchParams.get("cols"), "120");
    assert.deepStrictEqual(url.searchParams.getAll("cmd"), ["bash"]);
    assert.strictEqual(url.searchParams.get("path"), "bash");
  });
});

// ============================================================
// URL Construction — Attach Mode (upstream parity)
// ============================================================

describe("URL Construction: attach mode", () => {
  it("should use /exec/{sessionId} path", () => {
    const url = buildAttachUrl("42");

    assert.strictEqual(url.pathname, "/v1/sprites/my-sprite/exec/42");
  });

  it("should skip cmd/path/tty but pass env/dir (matching upstream)", () => {
    const url = buildAttachUrl("42", {
      tty: true,
      cwd: "/workspace",
      env: { FOO: "bar" },
    });

    assert.strictEqual(url.searchParams.get("stdin"), "true");
    // cmd, path, tty are NOT sent on attach
    assert.strictEqual(url.searchParams.get("cmd"), null);
    assert.strictEqual(url.searchParams.get("path"), null);
    assert.strictEqual(url.searchParams.get("tty"), null);
    // env and dir ARE sent on attach (upstream passes them through)
    assert.deepStrictEqual(url.searchParams.getAll("env"), ["FOO=bar"]);
    assert.strictEqual(url.searchParams.get("dir"), "/workspace");
  });

  it("should not use ?id= query param (uses path instead)", () => {
    const url = buildAttachUrl("123");

    assert.strictEqual(url.searchParams.get("id"), null);
    assert.ok(url.pathname.endsWith("/exec/123"));
  });
});

// ============================================================
// Message Decoding — session_info handling
// ============================================================

describe("Message decoding: session_info on attach", () => {
  it("should set waitingForSessionInfo on attach mode", () => {
    const session = SpriteWebsocketSession.createAttach(
      "my-sprite",
      "test-token",
      "https://api.sprites.dev",
      "42",
    );

    // Before start(), waitingForSessionInfo should not yet be set
    // (it's set in start() after ws.accept())
    assert.strictEqual((session as any).waitingForSessionInfo, false);
  });

  it("should not set waitingForSessionInfo on exec mode", () => {
    const session = SpriteWebsocketSession.createExec(
      "my-sprite",
      "test-token",
      "https://api.sprites.dev",
      "echo",
      ["hello"],
    );

    assert.strictEqual((session as any).waitingForSessionInfo, false);
  });

  it("should auto-detect TTY from session_info message", () => {
    const session = SpriteWebsocketSession.createAttach(
      "my-sprite",
      "test-token",
      "https://api.sprites.dev",
      "42",
    );

    // Simulate what happens after start() sets waitingForSessionInfo
    (session as any).waitingForSessionInfo = true;
    (session as any).ttyMode = false;

    // Simulate receiving session_info
    const sessionInfoMsg = JSON.stringify({
      type: "session_info",
      session_id: 42,
      command: "bash",
      created: Date.now(),
      tty: true,
      is_owner: true,
    });

    (session as any).handleMessage(sessionInfoMsg);

    // TTY should now be true from session_info
    assert.strictEqual((session as any).ttyMode, true);
    assert.strictEqual((session as any).waitingForSessionInfo, false);
  });
});

// ============================================================
// Control messages: resize and signal
// ============================================================

describe("Control messages", () => {
  it("resize should send correct JSON with type 'resize'", () => {
    const session = SpriteWebsocketSession.createExec(
      "my-sprite",
      "test-token",
      "https://api.sprites.dev",
      "bash",
      [],
      { tty: true },
    );

    // Capture what would be sent
    let sentData: string | null = null;
    (session as any).ws = {
      send(data: string) { sentData = data; },
      close() {},
    };
    (session as any).ttyMode = true;

    session.resize(120, 40);

    assert.ok(sentData !== null);
    const parsed = JSON.parse(sentData!);
    assert.strictEqual(parsed.type, "resize");
    assert.strictEqual(parsed.cols, 120);
    assert.strictEqual(parsed.rows, 40);
  });

  it("signal should send correct JSON with type 'signal'", () => {
    const session = SpriteWebsocketSession.createExec(
      "my-sprite",
      "test-token",
      "https://api.sprites.dev",
      "bash",
      [],
    );

    let sentData: string | null = null;
    (session as any).ws = {
      send(data: string) { sentData = data; },
      close() {},
    };

    session.signal("SIGTERM");

    assert.ok(sentData !== null);
    const parsed = JSON.parse(sentData!);
    assert.strictEqual(parsed.type, "signal");
    assert.strictEqual(parsed.signal, "SIGTERM");
  });
});
