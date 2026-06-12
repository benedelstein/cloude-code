import http from "node:http";
import https from "node:https";
import net from "node:net";
import { URL } from "node:url";
import { CertMinter } from "./ca";
import { loadConfig, type ProxyConfig } from "./config";

/**
 * Transparent on-sprite egress proxy.
 *
 * The agent process is configured with HTTPS_PROXY=localhost:<port> and trusts
 * the per-sprite CA. For hosts in the connector map, the proxy terminates TLS
 * with a minted leaf cert, rewrites the request to the worker connector
 * endpoint, and the worker injects the real secret. For every other host the
 * proxy is a blind TCP tunnel, so non-connector traffic keeps end-to-end TLS.
 */
function main(): void {
  const configPath = parseConfigPath(process.argv);
  const config = loadConfig(configPath);
  const minter = new CertMinter(config.caCertPath, config.caKeyPath);
  const workerUrl = new URL(config.connectorBaseUrl);

  // TLS-terminating server for intercepted hosts. Fed sockets from CONNECT.
  const mitmServer = https.createServer(
    {
      SNICallback: (servername, cb) => {
        try {
          cb(null, minter.secureContextFor(servername));
        } catch (error) {
          cb(error as Error);
        }
      },
    },
    (req, res) => {
      const host = stripPort(req.headers.host ?? "");
      const connectorId = config.hostMap[host];
      if (!connectorId) {
        res.writeHead(502).end("no connector for host");
        return;
      }
      forwardToWorker(config, workerUrl, connectorId, req.url ?? "/", req, res);
    },
  );
  mitmServer.on("clientError", () => {
    // swallow TLS handshake/parse errors; nothing actionable on the sprite side
  });

  const proxyServer = http.createServer((req, res) => {
    // Plain http:// forward-proxy requests carry an absolute URL.
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    const connectorId = config.hostMap[target.hostname];
    if (connectorId) {
      forwardToWorker(
        config,
        workerUrl,
        connectorId,
        `${target.pathname}${target.search}`,
        req,
        res,
      );
      return;
    }
    blindHttpForward(target, req, res);
  });

  proxyServer.on("connect", (req, clientSocket, head) => {
    const { host, port } = parseAuthority(req.url ?? "");
    if (config.hostMap[host]) {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) {
        clientSocket.unshift(head);
      }
      mitmServer.emit("connection", clientSocket);
      return;
    }
    // Not a connector host: blind TCP tunnel, end-to-end TLS preserved.
    const upstream = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });

  proxyServer.listen(config.port, "127.0.0.1", () => {
    process.stdout.write(`sprite-proxy listening on 127.0.0.1:${config.port}\n`);
  });
}

function forwardToWorker(
  config: ProxyConfig,
  workerUrl: URL,
  connectorId: string,
  pathAndQuery: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const basePath = workerUrl.pathname.replace(/\/+$/, "");
  const targetPath = `${basePath}/${connectorId}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;

  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  delete headers["proxy-connection"];
  // The worker authenticates this bearer, strips it, and injects the real key.
  headers.authorization = `Bearer ${config.connectorSecret}`;

  const upstreamReq = https.request(
    {
      protocol: workerUrl.protocol,
      hostname: workerUrl.hostname,
      port: workerUrl.port || 443,
      method: req.method,
      path: targetPath,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end("upstream error");
  });
  req.pipe(upstreamReq);
}

function blindHttpForward(
  target: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers["proxy-connection"];
  const upstreamReq = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end("upstream error");
  });
  req.pipe(upstreamReq);
}

function parseConfigPath(argv: string[]): string {
  const idx = argv.indexOf("--config");
  const value = idx >= 0 ? argv[idx + 1] : undefined;
  if (!value) {
    throw new Error("Missing --config <path>");
  }
  return value;
}

function stripPort(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, "");
}

function parseAuthority(authority: string): { host: string; port: number } {
  const [host, port] = authority.split(":");
  return { host: host ?? "", port: port ? Number(port) : 443 };
}

main();
