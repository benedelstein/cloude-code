import type { NormalizedToolAction, ToolKind } from "@repo/shared";

export interface ActionGroup {
  type: "group";
  kind: GroupableKind;
  actions: NormalizedToolAction[];
  /** Stable key from the first child action's toolCallId. */
  key: string;
}

export interface SingleAction {
  type: "single";
  action: NormalizedToolAction;
  key: string;
}

export type ActionItem = ActionGroup | SingleAction;

const GROUPABLE_KINDS = new Set<ToolKind>(["read", "search", "web", "other"]);

type GroupableKind = "read" | "search" | "web" | "other";

function isGroupable(kind: ToolKind): kind is GroupableKind {
  return GROUPABLE_KINDS.has(kind);
}

/**
 * Collapse adjacent same-kind groupable actions (read | search | web | other)
 * into a single group entry. Non-groupable kinds always render standalone.
 *
 * The output preserves input order. Groups are keyed by the first child
 * action's `toolCallId` so React can keep the row mounted as it grows during
 * streaming.
 */
export function groupActions(actions: NormalizedToolAction[]): ActionItem[] {
  const result: ActionItem[] = [];
  let current: ActionGroup | null = null;

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    if (isGroupable(action.kind)) {
      if (current && current.kind === action.kind) {
        current.actions.push(action);
        continue;
      }
      current = {
        type: "group",
        kind: action.kind,
        actions: [action],
        key: `group-${action.toolCallId}-${action.kind}`,
      };
      result.push(current);
    } else {
      current = null;
      result.push({
        type: "single",
        action,
        key: `single-${action.toolCallId}-${index}`,
      });
    }
  }

  // Unwrap singletons so a group of one renders identically to a non-grouped action.
  return result.map((item) => {
    if (item.type === "group" && item.actions.length === 1) {
      return {
        type: "single",
        action: item.actions[0]!,
        key: `single-${item.actions[0]!.toolCallId}`,
      };
    }
    return item;
  });
}
