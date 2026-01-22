export class SpritesError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public responseBody?: string
    ) {
        super(message);
        this.name = "SpritesError";
    }
}


export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface SessionOptions {
    cwd?: string;
    env?: Record<string, string>;
    tty?: boolean;
}