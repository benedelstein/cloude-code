/**
 * Minimal authenticated HTTP client for posting to the DO's webhook routes.
 * Exponential backoff on network errors and 5xx/429 for ~30s total, then
 * drops the request — the DO's reconcile path cleans up missed tail state.
 */

const MAX_ATTEMPTS = 7; // roughly: 250, 500, 1000, 2000, 4000, 5000, 5000 ms
const INITIAL_DELAY_MS = 250;
const MAX_DELAY_MS = 5_000;

export interface WebhookClientOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  logger?: (_level: "debug" | "warn", _message: string, _meta?: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebhookClient {
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly log: NonNullable<WebhookClientOptions["logger"]>;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    options: WebhookClientOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
    this.log = options.logger ?? (() => {});
  }

  async post(path: string, body: unknown): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    let delay = this.initialDelayMs;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const startedAt = Date.now();
      this.log("debug", "fetch: starting", { path, attempt });
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        this.log("debug", "fetch: resolved", {
          path,
          attempt,
          status: res.status,
          elapsedMs: Date.now() - startedAt,
        });
        if (res.ok) return;
        if (res.status < 500 && res.status !== 429) {
          this.log("warn", "webhook post received non-retryable status", {
            path,
            status: res.status,
          });
          return;
        }
        // For 429/5xx, honor a Retry-After header if present (capped at maxDelayMs
        // so a misbehaving server can't stall the loop).
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        if (retryAfterMs !== null) {
          delay = Math.min(retryAfterMs, this.maxDelayMs);
        }
        this.log("debug", "webhook post failed, will retry", {
          path,
          status: res.status,
          attempt,
        });
      } catch (error) {
        this.log("debug", "fetch: threw, will retry", {
          path,
          attempt,
          elapsedMs: Date.now() - startedAt,
          error: String(error),
          url,
        });
      }

      if (attempt >= this.maxAttempts) {
        this.log("warn", "webhook post exhausted retries, dropping", { path });
        return;
      }
      const jitterMs = Math.random() * 100;
      await sleep(delay + jitterMs);
      delay = Math.min(delay * 2, this.maxDelayMs);
    }
  }
}

/**
 * Parses an HTTP Retry-After header value (RFC 7231 §7.1.3) into milliseconds.
 * Supports both delta-seconds and HTTP-date forms. Returns null for missing or
 * unparseable values, or when the date is in the past.
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  const epochMs = Date.parse(trimmed);
  if (!Number.isNaN(epochMs)) {
    const deltaMs = epochMs - Date.now();
    return deltaMs > 0 ? deltaMs : 0;
  }
  return null;
}
