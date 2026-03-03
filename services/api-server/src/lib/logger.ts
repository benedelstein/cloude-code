import { ComposedLogger, ConsoleLogger, type Logger } from "@repo/shared";

export const logger: Logger = new ComposedLogger(
  [
    new ConsoleLogger({
      format: "pretty",
    }),
  ],
);
