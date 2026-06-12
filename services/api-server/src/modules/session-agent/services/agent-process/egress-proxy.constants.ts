import type { SessionEnvironmentSnapshot } from "@repo/shared";

/**
 * Localhost port the on-sprite egress proxy listens on. The agent is pointed at
 * it via HTTP(S)_PROXY. Chosen high to avoid clashing with user dev servers.
 */
export const EGRESS_PROXY_PORT = 41121;

const EGRESS_PROXY_DIR = "/home/sprite/.cloude/proxy";
export const EGRESS_PROXY_SCRIPT_PATH = `${EGRESS_PROXY_DIR}/sprite-proxy.js`;
export const EGRESS_PROXY_CONFIG_PATH = `${EGRESS_PROXY_DIR}/config.json`;
export const EGRESS_PROXY_CA_CERT_PATH = `${EGRESS_PROXY_DIR}/ca.crt`;
export const EGRESS_PROXY_CA_KEY_PATH = `${EGRESS_PROXY_DIR}/ca.key`;
export { EGRESS_PROXY_DIR };

/** System trust bundle the per-sprite CA is appended to via update-ca-certificates. */
const SYSTEM_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";

/**
 * Environment variables that route the agent's egress through the on-sprite
 * proxy and trust the per-sprite CA. Returns an empty object when the session
 * has no connectors, so normal sessions are completely unaffected.
 */
export function buildEgressProxyAgentEnv(
  snapshot: SessionEnvironmentSnapshot,
): Record<string, string> {
  if (snapshot.connectors.length === 0) {
    return {};
  }
  const proxyUrl = `http://127.0.0.1:${EGRESS_PROXY_PORT}`;
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
    // Node appends this to its defaults; the others point at the system bundle
    // which already includes our CA after update-ca-certificates.
    NODE_EXTRA_CA_CERTS: EGRESS_PROXY_CA_CERT_PATH,
    SSL_CERT_FILE: SYSTEM_CA_BUNDLE,
    REQUESTS_CA_BUNDLE: SYSTEM_CA_BUNDLE,
    GIT_SSL_CAINFO: SYSTEM_CA_BUNDLE,
  };
}

/** Build the hostname -> connector id map the proxy intercepts on. */
export function buildConnectorHostMap(
  snapshot: SessionEnvironmentSnapshot,
): Record<string, string> {
  const hostMap: Record<string, string> = {};
  for (const connector of snapshot.connectors) {
    for (const host of connector.matchHosts) {
      hostMap[host] = connector.id;
    }
  }
  return hostMap;
}
