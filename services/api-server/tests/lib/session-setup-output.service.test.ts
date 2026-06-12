import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger, ServerMessage, SetupOutputChunksEvent } from "@repo/shared";
import type { SetupOutputRepository } from "../../src/modules/session-agent/repositories/setup-output.repository";
import { SETUP_OUTPUT_STORE_CAP } from "../../src/modules/session-agent/repositories/setup-output.repository";
import { SessionSetupOutputService } from "../../src/modules/session-agent/services/session-setup-output.service";

function createLogger(): Logger {
  const logger: Logger = {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return logger;
    },
  };
  return logger;
}

function createService() {
  const appended: Array<{ stream: string; data: string }> = [];
  const repository = {
    append: vi.fn((stream: "stdout" | "stderr", data: string) => {
      appended.push({ stream, data });
    }),
    compact: vi.fn(),
    clear: vi.fn(),
  } as unknown as SetupOutputRepository;
  const broadcasts: ServerMessage[] = [];
  const service = new SessionSetupOutputService({
    logger: createLogger(),
    repository,
    broadcastMessage: (message) => broadcasts.push(message),
  });
  return { appended, broadcasts, repository, service };
}

function setupOutputEvents(broadcasts: ServerMessage[]): SetupOutputChunksEvent[] {
  return broadcasts.filter(
    (message): message is SetupOutputChunksEvent => message.type === "setup.output.chunks",
  );
}

describe("SessionSetupOutputService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes buffered output on the interval", () => {
    const { appended, broadcasts, service } = createService();
    service.beginRun();

    service.append("stdout", "line 1\n");
    service.append("stderr", "warn 1\n");
    expect(broadcasts).toHaveLength(0);

    vi.advanceTimersByTime(250);

    const events = setupOutputEvents(broadcasts);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      taskId: "setup_script",
      epoch: service.getEpoch(),
      chunks: [
        { stream: "stdout", data: "line 1\n", offset: 0 },
        { stream: "stderr", data: "warn 1\n", offset: 0 },
      ],
    });
    expect(appended).toEqual([
      { stream: "stdout", data: "line 1\n" },
      { stream: "stderr", data: "warn 1\n" },
    ]);
  });

  it("flushes immediately once pending output exceeds the size threshold", () => {
    const { broadcasts, service } = createService();
    service.beginRun();

    service.append("stdout", "x".repeat(5000));

    const events = setupOutputEvents(broadcasts);
    expect(events).toHaveLength(1);
    expect(events[0]!.chunks[0]).toMatchObject({ stream: "stdout", offset: 0 });
  });

  it("tracks per-stream offsets across flushes", () => {
    const { broadcasts, service } = createService();
    service.beginRun();

    service.append("stdout", "abc");
    vi.advanceTimersByTime(250);
    service.append("stdout", "def");
    service.append("stderr", "x");
    vi.advanceTimersByTime(250);

    const events = setupOutputEvents(broadcasts);
    expect(events[1]!.chunks).toEqual([
      { stream: "stdout", data: "def", offset: 3 },
      { stream: "stderr", data: "x", offset: 0 },
    ]);
  });

  it("stops persisting and broadcasting beyond the storage cap", () => {
    const { appended, broadcasts, service } = createService();
    service.beginRun();

    service.append("stdout", "x".repeat(SETUP_OUTPUT_STORE_CAP - 1));
    service.append("stdout", "yy");
    service.append("stdout", "dropped entirely");
    const result = service.finish();

    expect(result).toEqual({
      stdoutLength: SETUP_OUTPUT_STORE_CAP,
      stderrLength: 0,
      truncated: true,
    });
    const totalBroadcast = setupOutputEvents(broadcasts)
      .flatMap((event) => event.chunks)
      .reduce((sum, chunk) => sum + chunk.data.length, 0);
    expect(totalBroadcast).toBe(SETUP_OUTPUT_STORE_CAP);
    const totalAppended = appended.reduce((sum, entry) => sum + entry.data.length, 0);
    expect(totalAppended).toBe(SETUP_OUTPUT_STORE_CAP);
  });

  it("does not split a surrogate pair at the storage cap", () => {
    const { broadcasts, service } = createService();
    service.beginRun();

    // The pair straddles the cap; the lone high surrogate must be dropped.
    service.append("stdout", "x".repeat(SETUP_OUTPUT_STORE_CAP - 1) + "\u{1F600}");
    const result = service.finish();

    const data = setupOutputEvents(broadcasts)
      .flatMap((event) => event.chunks)
      .map((chunk) => chunk.data)
      .join("");
    expect(data).toHaveLength(SETUP_OUTPUT_STORE_CAP - 1);
    expect(data.at(-1)).toBe("x");
    expect(result).toEqual({
      stdoutLength: SETUP_OUTPUT_STORE_CAP,
      stderrLength: 0,
      truncated: true,
    });
  });

  it("flushes pending output and compacts on finish", () => {
    const { broadcasts, repository, service } = createService();
    service.beginRun();

    service.append("stdout", "tail");
    const result = service.finish();

    expect(setupOutputEvents(broadcasts)).toHaveLength(1);
    expect(repository.compact).toHaveBeenCalledWith("stdout");
    expect(repository.compact).toHaveBeenCalledWith("stderr");
    expect(result).toEqual({ stdoutLength: 4, stderrLength: 0, truncated: false });
  });

  it("starts a new epoch and clears stored output on beginRun", () => {
    const { broadcasts, repository, service } = createService();
    service.beginRun();
    const firstEpoch = service.getEpoch();
    service.append("stdout", "stale");

    service.beginRun();
    service.append("stdout", "fresh");
    vi.advanceTimersByTime(250);

    expect(repository.clear).toHaveBeenCalledTimes(2);
    const events = setupOutputEvents(broadcasts);
    expect(events).toHaveLength(1);
    expect(events[0]!.epoch).not.toBe(firstEpoch);
    expect(events[0]!.chunks).toEqual([
      { stream: "stdout", data: "fresh", offset: 0 },
    ]);
  });
});
