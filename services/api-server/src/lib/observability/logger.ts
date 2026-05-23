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
 * so it picks up any reconfiguration from initializeLogger(). The scoped
 * logger is cached and only re-created when the root changes.
 */
export function createLogger(loggerName: string): Logger {
  let cachedRootRef: Logger = rootLogger;
  let scopedLogger: Logger = rootLogger.scope(loggerName);

  const get = (): Logger => {
    if (rootLogger !== cachedRootRef) {
      cachedRootRef = rootLogger;
      scopedLogger = rootLogger.scope(loggerName);
    }
    return scopedLogger;
  };

  return {
    log: (message: string, params?: LogParams) => get().log(message, params),
    debug: (message: string, params?: LogParams) => get().debug(message, params),
    info: (message: string, params?: LogParams) => get().info(message, params),
    warn: (message: string, params?: LogParams) => get().warn(message, params),
    error: (message: string, params?: LogParams) => get().error(message, params),
    scope: (name: string) => createLogger(name),
  };
}
