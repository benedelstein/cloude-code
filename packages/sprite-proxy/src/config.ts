import { readFileSync } from "node:fs";

/**
 * Runtime configuration for the on-sprite egress proxy, written by the worker
 * during session provisioning. Contains no real secrets beyond the per-session
 * connector bearer — the upstream API keys live in the worker.
 */
export interface ProxyConfig {
  /** Localhost port the proxy listens on (HTTPS_PROXY target). */
  port: number;
  /** Worker connector base URL, e.g. https://worker/connector/{sessionId} */
  connectorBaseUrl: string;
  /** Per-session bearer the proxy presents to the worker connector endpoint. */
  connectorSecret: string;
  /** PEM paths for the per-sprite MITM CA. */
  caCertPath: string;
  caKeyPath: string;
  /** Map of intercepted hostname -> connector id. */
  hostMap: Record<string, string>;
}

export function loadConfig(path: string): ProxyConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ProxyConfig;
  if (
    typeof parsed.port !== "number" ||
    typeof parsed.connectorBaseUrl !== "string" ||
    typeof parsed.connectorSecret !== "string" ||
    typeof parsed.caCertPath !== "string" ||
    typeof parsed.caKeyPath !== "string" ||
    typeof parsed.hostMap !== "object" ||
    parsed.hostMap === null
  ) {
    throw new Error("Invalid proxy config");
  }
  return parsed;
}
