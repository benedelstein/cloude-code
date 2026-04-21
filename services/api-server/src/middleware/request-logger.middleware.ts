import type { MiddlewareHandler } from "hono";

function getSafeUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}${url.pathname}`;
}

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function logRequestLine(method: string, safeUrl: string, status: number): void {
  const line = `${method} ${safeUrl} - ${status} @ ${formatTimestamp(new Date())}`;

  if (status >= 500) {
    console.error(line);
    return;
  }

  if (status >= 400) {
    console.warn(line);
    return;
  }

  console.log(line);
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
