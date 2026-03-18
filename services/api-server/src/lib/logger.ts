import { ComposedLogger, ConsoleLogger, type Logger } from "@repo/shared";

const rootLogger: Logger = new ComposedLogger(
  [
    new ConsoleLogger({
      format: "pretty",
    }),
  ],
);

export function createLogger(loggerName: string): Logger {
  return rootLogger.scope(loggerName);
}
