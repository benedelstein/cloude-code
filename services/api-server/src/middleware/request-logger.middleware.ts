import type { MiddlewareHandler } from "hono";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("request-logger.middleware.ts");

function getSafeUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}${url.pathname}`;
}

function logRequestLine(method: string, safeUrl: string, status: number): void {
  const fields = { method, url: safeUrl, status };

  if (status >= 500) {
    logger.error("Request completed", { fields });
    return;
  }

  if (status >= 400) {
    logger.warn("Request completed", { fields });
    return;
  }

  logger.info("Request completed", { fields });
}

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const safeUrl = getSafeUrl(c.req.url);

  try {
    await next();
  } catch (error) {
    logRequestLine(method, safeUrl, 500);
    throw error;
  }

  logRequestLine(method, safeUrl, c.res.status);
};
