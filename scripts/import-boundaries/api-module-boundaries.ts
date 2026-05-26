import type { ImportEdge } from "./types";
import { toRepoPath } from "./path-utils";

type ApiModuleLayer =
  | "route"
  | "middleware"
  | "service"
  | "repository"
  | "utils"
  | "types"
  | "other";

type ApiArea =
  | { kind: "shared" }
  | {
      kind: "module";
      moduleName: string;
      layer: ApiModuleLayer;
    }
  | { kind: "other-api-source" };

export function checkApiModuleBoundary(
  edge: ImportEdge,
  targetFile: string,
): string | null {
  const sourceArea = classifyApiArea(toRepoPath(edge.sourceFile));
  const targetArea = classifyApiArea(toRepoPath(targetFile));

  if (!sourceArea || !targetArea) {
    return null;
  }

  if (sourceArea.kind === "shared" && targetArea.kind === "module") {
    return "services/api-server/src/shared must not import API modules.";
  }

  if (sourceArea.kind !== "module") {
    return null;
  }

  if (targetArea.kind === "shared") {
    return null;
  }

  if (targetArea.kind !== "module") {
    return "API modules can only import their own module, services/api-server/src/shared, or workspace packages.";
  }

  if (sourceArea.moduleName !== targetArea.moduleName) {
    return "API modules must not import other API modules.";
  }

  return checkSameModuleLayerBoundary(sourceArea.layer, targetArea.layer);
}

function classifyApiArea(repoPath: string): ApiArea | null {
  // TODO: use string constants for paths.
  if (!repoPath.startsWith("services/api-server/src/")) {
    return null;
  }

  if (repoPath.startsWith("services/api-server/src/shared/")) {
    return { kind: "shared" };
  }

  const moduleMatch = repoPath.match(
    /^services\/api-server\/src\/modules\/([^/]+)\/(.+)$/,
  );
  if (!moduleMatch) {
    return { kind: "other-api-source" };
  }

  return {
    kind: "module",
    moduleName: moduleMatch[1]!,
    layer: classifyApiModuleLayer(moduleMatch[2]!),
  };
}

function classifyApiModuleLayer(rest: string): ApiModuleLayer {
  const parts = rest.split("/");
  const firstPart = parts[0];
  const basename = parts[parts.length - 1] ?? rest;

  if (basename.endsWith(".types.ts") || firstPart === "types") {
    return "types";
  }

  if (
    basename.endsWith(".util.ts")
    || basename.endsWith(".utils.ts")
    || firstPart === "utils"
  ) {
    return "utils";
  }

  if (basename.endsWith(".repository.ts") || firstPart === "repositories") {
    return "repository";
  }

  if (
    basename.endsWith(".service.ts")
    || basename.endsWith(".providers.ts")
    || firstPart === "services"
    || firstPart === "providers"
  ) {
    return "service";
  }

  if (basename.endsWith(".middleware.ts") || firstPart === "middleware") {
    return "middleware";
  }

  if (
    basename.endsWith(".routes.ts")
    || basename.endsWith(".schema.ts")
    || firstPart === "routes"
  ) {
    return "route";
  }

  return "other";
}

function checkSameModuleLayerBoundary(
  sourceLayer: ApiModuleLayer,
  targetLayer: ApiModuleLayer,
): string | null {
  const sourceRank = getApiModuleLayerRank(sourceLayer);
  const targetRank = getApiModuleLayerRank(targetLayer);

  if (sourceRank === null || targetRank === null || sourceRank >= targetRank) {
    return null;
  }

  return "Same-module imports must point toward lower layers: routes -> middleware -> services -> repositories -> utils -> types.";
}

function getApiModuleLayerRank(kind: ApiModuleLayer): number | null {
  switch (kind) {
    case "types":
      return 0;
    case "utils":
      return 1;
    case "repository":
      return 2;
    case "service":
      return 3;
    case "middleware":
      return 4;
    case "route":
      return 5;
    case "other":
      return null;
  }
}
