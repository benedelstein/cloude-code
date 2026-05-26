import type { ImportEdge } from "./types";
import { toRepoPath } from "./path-utils";

type WorkspaceArea =
  | { kind: "app"; name: string }
  | { kind: "package"; name: string }
  | { kind: "service"; name: string };

export function checkPackageBoundary(
  edge: ImportEdge,
  targetFile: string,
): string | null {
  const sourceArea = classifyWorkspaceArea(toRepoPath(edge.sourceFile));
  const targetArea = classifyWorkspaceArea(toRepoPath(targetFile));

  if (!sourceArea || !targetArea) {
    return null;
  }

  if (
    sourceArea.kind === "package"
    && (targetArea.kind === "app" || targetArea.kind === "service")
  ) {
    return "packages/* must not import apps/* or services/*.";
  }

  if (sourceArea.kind === "app" && targetArea.kind === "service") {
    return "apps/* must not import services/*.";
  }

  if (sourceArea.kind === "service" && targetArea.kind === "app") {
    return "services/* must not import apps/*.";
  }

  return null;
}

function classifyWorkspaceArea(repoPath: string): WorkspaceArea | null {
  const match = repoPath.match(/^(apps|packages|services)\/([^/]+)\//);
  if (!match) {
    return null;
  }

  const root = match[1]!;
  const name = match[2]!;
  switch (root) {
    case "apps":
      return { kind: "app", name };
    case "packages":
      return { kind: "package", name };
    case "services":
      return { kind: "service", name };
    default:
      return null;
  }
}
