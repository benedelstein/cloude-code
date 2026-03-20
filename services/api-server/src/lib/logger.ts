import { ComposedLogger, ConsoleLogger, type LogLevel, type Logger, type LogParams } from "@repo/shared";

// Default logger used before initializeLogger() is called.
// Safe at module scope since it doesn't depend on env.
let rootLogger: Logger = new ComposedLogger(
  [new ConsoleLogger({ format: "pretty" })],
  "info"
);

/**
 * Reconfigure the root logger with environment-specific settings.
 * Call this early in the request lifecycle (e.g. Hono middleware).
 */
export function initializeLogger(options?: { level?: LogLevel; format?: "pretty" | "json" }): void {
  rootLogger = new ComposedLogger(
    [new ConsoleLogger({ format: options?.format ?? "pretty" })],
    options?.level ?? "info"
  );
}

/**
 * Returns a named logger that lazily delegates to the current rootLogger,
 * so it picks up any reconfiguration from initializeLogger().
 */
export function createLogger(loggerName: string): Logger {
  return {
    log: (message: string, params?: LogParams) => rootLogger.log(message, { ...params, loggerName }),
    debug: (message: string, params?: LogParams) => rootLogger.debug(message, { ...params, loggerName }),
    info: (message: string, params?: LogParams) => rootLogger.info(message, { ...params, loggerName }),
    warn: (message: string, params?: LogParams) => rootLogger.warn(message, { ...params, loggerName }),
    error: (message: string, params?: LogParams) => rootLogger.error(message, { ...params, loggerName }),
    scope: (name: string) => createLogger(name),
  };
}
