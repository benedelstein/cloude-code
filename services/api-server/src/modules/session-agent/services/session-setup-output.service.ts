import type { Logger, ServerMessage, SetupOutputChunk } from "@repo/shared";
import {
  SETUP_OUTPUT_STORE_CAP,
  type SetupOutputRepository,
  type SetupOutputStream,
} from "../repositories/setup-output.repository";

/** Flush immediately once this much output is pending. */
const FLUSH_MAX_CHARS = 4096;
/** Otherwise flush this long after the first pending chunk. */
const FLUSH_INTERVAL_MS = 250;

export interface SetupOutputFinishResult {
  stdoutLength: number;
  stderrLength: number;
  truncated: boolean;
}

/** Narrow surface the provisioner needs; keeps it decoupled from this service. */
export interface SessionSetupOutputCollector {
  beginRun(): void;
  append(stream: SetupOutputStream, data: string): void;
  finish(): SetupOutputFinishResult;
}

export interface SessionSetupOutputServiceDeps {
  logger: Logger;
  repository: SetupOutputRepository;
  broadcastMessage: (message: ServerMessage) => void;
}

/**
 * Collects setup-script output while the script runs: persists it to the
 * setup-output repository and broadcasts batched `setup.output.chunks` events
 * to connected clients. Batches on size (4 KB) or interval (250 ms) so tiny
 * exec chunks don't each become a row and a broadcast.
 */
export class SessionSetupOutputService implements SessionSetupOutputCollector {
  private readonly logger: Logger;
  private readonly repository: SetupOutputRepository;
  private readonly broadcastMessage: (message: ServerMessage) => void;

  /** Unique per script run; clients reset accumulated output when it changes. */
  private epoch: string = crypto.randomUUID();
  private offsets: Record<SetupOutputStream, number> = { stdout: 0, stderr: 0 };
  private truncated = false;
  private pendingChunks: SetupOutputChunk[] = [];
  private pendingChars = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: SessionSetupOutputServiceDeps) {
    this.logger = deps.logger.scope("session-setup-output");
    this.repository = deps.repository;
    this.broadcastMessage = deps.broadcastMessage;
  }

  getEpoch(): string {
    return this.epoch;
  }

  /** Resets stored output and starts a new epoch. Call before each script run. */
  beginRun(): void {
    this.clearFlushTimer();
    this.pendingChunks = [];
    this.pendingChars = 0;
    this.epoch = crypto.randomUUID();
    this.offsets = { stdout: 0, stderr: 0 };
    this.truncated = false;
    this.repository.clear();
  }

  /** Buffers one raw exec chunk for persistence and broadcast. */
  append(stream: SetupOutputStream, data: string): void {
    if (data.length === 0) {
      return;
    }
    const remaining = SETUP_OUTPUT_STORE_CAP - this.offsets[stream];
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    // Drop output beyond the cap for both storage and broadcast so the fetch
    // endpoint and the live stream always agree.
    const accepted = data.length > remaining ? data.slice(0, remaining) : data;
    if (accepted.length < data.length) {
      this.truncated = true;
    }
    this.pendingChunks.push({ stream, data: accepted, offset: this.offsets[stream] });
    this.offsets[stream] += accepted.length;
    this.pendingChars += accepted.length;

    if (this.pendingChars >= FLUSH_MAX_CHARS) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Flushes any pending output, compacts stored rows, and returns the run's
   * output metadata for the setup task. Call once when the script finishes.
   */
  finish(): SetupOutputFinishResult {
    this.flush();
    this.repository.compact("stdout");
    this.repository.compact("stderr");
    this.logger.info("Setup output finished", {
      fields: {
        stdoutLength: this.offsets.stdout,
        stderrLength: this.offsets.stderr,
        truncated: this.truncated,
      },
    });
    return {
      stdoutLength: this.offsets.stdout,
      stderrLength: this.offsets.stderr,
      truncated: this.truncated,
    };
  }

  private flush(): void {
    this.clearFlushTimer();
    if (this.pendingChunks.length === 0) {
      return;
    }
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    this.pendingChars = 0;

    // One row per stream per flush keeps writes small and row counts bounded.
    for (const stream of ["stdout", "stderr"] as const) {
      const data = chunks
        .filter((chunk) => chunk.stream === stream)
        .map((chunk) => chunk.data)
        .join("");
      if (data.length > 0) {
        this.repository.append(stream, data);
      }
    }

    this.broadcastMessage({
      type: "setup.output.chunks",
      taskId: "setup_script",
      epoch: this.epoch,
      chunks,
    });
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
