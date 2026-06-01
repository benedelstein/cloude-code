import type { Logger, PlainEnvVars } from "@repo/shared";
import type { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";

const STARTUP_SCRIPT_TIMEOUT_SECONDS = 300;
const STARTUP_SCRIPT_OUTPUT_LIMIT = 8000;

export class SessionStartupScriptService {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.scope("session-startup-script");
  }

  async run(args: {
    sprite: WorkersSpriteClient;
    script: string | null;
    workspaceDir: string;
    env: PlainEnvVars;
  }): Promise<void> {
    const script = args.script?.trim();
    if (!script) {
      this.logger.info("No session startup script configured", {
        fields: {
          workspaceDir: args.workspaceDir,
          envVarCount: Object.keys(args.env).length,
        },
      });
      return;
    }

    this.logger.info("Running session startup script", {
      fields: {
        workspaceDir: args.workspaceDir,
        scriptLength: script.length,
        envVarCount: Object.keys(args.env).length,
        timeoutSeconds: STARTUP_SCRIPT_TIMEOUT_SECONDS,
      },
    });
    const d0 = Date.now();
    const result = await args.sprite.execHttp(
      `timeout ${STARTUP_SCRIPT_TIMEOUT_SECONDS}s bash -lc ${shellQuote(script)}`,
      {
        dir: args.workspaceDir,
        env: args.env,
      },
    );
    const durationMs = Date.now() - d0;

    if (result.exitCode !== 0) {
      this.logger.warn("Session startup script failed", {
        fields: {
          exitCode: result.exitCode,
          durationMs,
          stdout: truncateOutput(result.stdout),
          stderr: truncateOutput(result.stderr),
        },
      });
      throw new SessionStartupScriptError(result.exitCode, durationMs);
    }

    this.logger.info("Session startup script completed", {
      fields: {
        durationMs,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
      },
    });
  }
}

class SessionStartupScriptError extends Error {
  constructor(exitCode: number, durationMs: number) {
    super(`Startup script failed with exit code ${exitCode} after ${durationMs}ms`);
    this.name = "SessionStartupScriptError";
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function truncateOutput(value: string): string {
  return value.length > STARTUP_SCRIPT_OUTPUT_LIMIT
    ? `${value.slice(0, STARTUP_SCRIPT_OUTPUT_LIMIT)}...`
    : value;
}
