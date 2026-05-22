import type { DynamicToolUIPart, ToolUIPart, UITools } from "ai";

export type NormalizableToolUIPart = DynamicToolUIPart | ToolUIPart<UITools>;

export type ToolKind =
  | "read"
  | "edit"
  | "write"
  | "bash"
  | "search"
  | "web"
  | "todo"
  | "plan"
  | "other";

export interface ReadAction {
  /** One or more file paths read in this action. */
  paths: string[];
  /** 1-indexed line range requested by the read tool when it was scoped. */
  lineRange?: {
    start: number;
    end?: number;
  };
  /** File contents returned by the read tool when available. */
  content?: string;
}

export interface EditAction {
  path: string;
  /** Unified diff text. May be empty during input-streaming. */
  diff: string;
}

export interface WriteAction {
  path: string;
  /** Full file contents when present. */
  content?: string;
  isNew?: boolean;
  deleted?: boolean;
}

export interface BashAction {
  command: string;
  output?: string;
  exitCode?: number | null;
  status?: string;
}

export interface SearchAction {
  patterns: string[];
}

export interface WebAction {
  kind: "fetch" | "search";
  url?: string;
  query?: string;
}

export interface TodoAction {
  todos: unknown;
}

export interface PlanAction {
  plan: string;
}

export interface OtherAction {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

/** Provider-agnostic tool payloads */
export type NormalizedToolPayload =
  | { kind: "read"; payload: ReadAction }
  | { kind: "edit"; payload: EditAction }
  | { kind: "write"; payload: WriteAction }
  | { kind: "bash"; payload: BashAction }
  | { kind: "search"; payload: SearchAction }
  | { kind: "web"; payload: WebAction }
  | { kind: "todo"; payload: TodoAction }
  | { kind: "plan"; payload: PlanAction }
  | { kind: "other"; payload: OtherAction };

export type NormalizedToolAction = NormalizedToolPayload & {
  toolName: string;
  toolCallId: string;
  state: NormalizableToolUIPart["state"];
  errorText?: string;
};

export interface ToolPartNormalizer {
  /**
   * Map an assembled tool UI part from this provider into one or more actions.
   * pure and side-effect-free. For tool names this provider does not
   * recognize, return a single `kind: "other"` action via the shared fallback —
   * never throw.
   */
  normalize(part: NormalizableToolUIPart): NormalizedToolAction[];
}
