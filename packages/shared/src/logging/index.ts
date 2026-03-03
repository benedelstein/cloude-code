export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: LogValue }
  | LogValue[];

export type LogFields = Record<string, LogValue>;

export interface LogEntry {
  level: LogLevel;
  message: string;
  loggerName?: string;
  timestamp?: string;
  fields?: LogFields;
  error?: unknown;
}

export interface LogParams {
  loggerName?: string;
  timestamp?: string;
  fields?: LogFields;
  error?: unknown;
}

/* eslint-disable no-unused-vars */
export interface Logger {
  log(message: string, params?: LogParams): void;
  debug(message: string, params?: LogParams): void;
  info(message: string, params?: LogParams): void;
  warn(message: string, params?: LogParams): void;
  error(message: string, params?: LogParams): void;
}
/* eslint-enable no-unused-vars */

export interface ConsoleLoggerOptions {
  includeTimestamp?: boolean;
  now?: () => Date;
  format?: "pretty" | "json";
}

export class ConsoleLogger implements Logger {
  private readonly includeTimestamp: boolean;
  private readonly now: () => Date;
  private readonly format: "pretty" | "json";

  public constructor(options?: ConsoleLoggerOptions) {
    this.includeTimestamp = options?.includeTimestamp ?? true;
    this.now = options?.now ?? (() => new Date());
    this.format = options?.format ?? "pretty";
  }

  public log(message: string, params?: LogParams): void {
    this.write("info", message, params);
  }

  public debug(message: string, params?: LogParams): void {
    this.write("debug", message, params);
  }

  public info(message: string, params?: LogParams): void {
    this.write("info", message, params);
  }

  public warn(message: string, params?: LogParams): void {
    this.write("warn", message, params);
  }

  public error(message: string, params?: LogParams): void {
    this.write("error", message, params);
  }

  private write(level: LogLevel, message: string, params?: LogParams): void {
    const entry = this.buildEntry(level, message, params);
    const serializedEntry = this.buildSerializedEntry(entry);
    const line =
      this.format === "json"
        ? this.serializeAsJson(serializedEntry)
        : this.serializeAsPretty(serializedEntry);
    this.writeLine(level, line);
  }

  private buildEntry(
    level: LogLevel,
    message: string,
    params?: LogParams,
  ): LogEntry {
    return {
      level,
      message,
      ...params,
    };
  }

  private buildSerializedEntry(entry: LogEntry): LogEntry {
    if (entry.timestamp || !this.includeTimestamp) {
      return entry;
    }

    return {
      ...entry,
      timestamp: this.now().toISOString(),
    };
  }

  private writeLine(level: LogLevel, line: string): void {
    switch (level) {
      case "debug":
        console.debug(line);
        return;
      case "info":
        console.info(line);
        return;
      case "warn":
        console.warn(line);
        return;
      case "error":
        console.error(line);
        return;
      default:
        console.log(line);
    }
  }

  private serializeAsJson(entry: LogEntry): string {
    return JSON.stringify(entry, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      return value;
    });
  }

  private serializeAsPretty(entry: LogEntry): string {
    const prefixParts = [`[${entry.level.toUpperCase()}]`];

    if (entry.timestamp) {
      prefixParts.push(`[${entry.timestamp}]`);
    }

    if (entry.loggerName) {
      prefixParts.push(`[${entry.loggerName}]`);
    }

    let line = `${prefixParts.join(" ")} ${entry.message}`;

    if (entry.fields && Object.keys(entry.fields).length > 0) {
      line += ` ${JSON.stringify(entry.fields)}`;
    }

    if (entry.error !== undefined) {
      line += ` error=${this.stringifyUnknown(entry.error)}`;
    }

    return line;
  }

  private stringifyUnknown(value: unknown): string {
    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack,
      });
    }

    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

export class ComposedLogger implements Logger {
  private readonly loggers: readonly Logger[];

  public constructor(loggers: readonly Logger[]) {
    this.loggers = loggers;
  }

  public log(message: string, params?: LogParams): void {
    this.dispatch("log", message, params);
  }

  public debug(message: string, params?: LogParams): void {
    this.dispatch("debug", message, params);
  }

  public info(message: string, params?: LogParams): void {
    this.dispatch("info", message, params);
  }

  public warn(message: string, params?: LogParams): void {
    this.dispatch("warn", message, params);
  }

  public error(message: string, params?: LogParams): void {
    this.dispatch("error", message, params);
  }

  private dispatch(
    method: "log" | "debug" | "info" | "warn" | "error",
    message: string,
    params?: LogParams,
  ): void {
    const loggingErrors: unknown[] = [];

    for (const logger of this.loggers) {
      try {
        logger[method](message, params);
      } catch (error) {
        loggingErrors.push(error);
      }
    }

    if (loggingErrors.length === 0) {
      return;
    }

    if (loggingErrors.length === 1) {
      throw loggingErrors[0];
    }

    throw new AggregateError(
      loggingErrors,
      "ComposedLogger encountered multiple logger failures",
    );
  }
}
