import { extractImports } from "../../../scripts/import-boundaries/import-parser";
import { resolveImportTarget } from "../../../scripts/import-boundaries/import-resolver";
import {
  collectSourceFilesFromRoots,
  toRepoPath,
} from "../../../scripts/import-boundaries/path-utils";
import type {
  BoundaryViolation,
  ImportEdge,
} from "../../../scripts/import-boundaries/types";

type ApiModuleLayer =
  | "route"
  | "middleware"
  | "service"
  | "repository"
  | "utils"
  | "types";

type ApiArea =
  | { kind: "shared" }
  | {
      kind: "module";
      moduleName: string;
      layer: ApiModuleLayer;
    }
  | {
      kind: "unclassifiedModule";
      moduleName: string;
      repoPath: string;
    }
  | { kind: "root" };

const API_SERVER_SRC_ROOT = "services/api-server/src";
const API_SERVER_SRC_PREFIX = `${API_SERVER_SRC_ROOT}/`;
const API_SHARED_ROOT = `${API_SERVER_SRC_ROOT}/shared`;
const API_SHARED_PREFIX = `${API_SHARED_ROOT}/`;
const API_MODULES_PREFIX = `${API_SERVER_SRC_ROOT}/modules/`;
const API_MODULES_PATTERN =
  /^services\/api-server\/src\/modules\/([^/]+)\/(.+)$/;

const apiAreaImportGraph = {
  root: ["root", "shared", "module"],
  shared: ["shared"],
  module: ["shared", "module"],
  unclassifiedModule: [],
} satisfies Record<ApiArea["kind"], readonly ApiArea["kind"][]>;

const moduleLayerImportGraph = {
  route: ["route", "middleware", "service", "repository", "utils", "types"],
  middleware: ["middleware", "service", "repository", "utils", "types"],
  service: ["service", "repository", "utils", "types"],
  repository: ["repository", "utils", "types"],
  utils: ["utils", "types"],
  types: ["types"],
} satisfies Record<ApiModuleLayer, readonly ApiModuleLayer[]>;

function checkBoundaries(): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const startTime = Date.now();

  for (const sourceFile of collectSourceFilesFromRoots([API_SERVER_SRC_ROOT])) {
    for (const edge of extractImports(sourceFile)) {
      const targetFile = resolveImportTarget(sourceFile, edge.specifier);
      if (!targetFile) {
        continue;
      }

      const message = checkApiModuleBoundary(edge, targetFile);
      if (message) {
        violations.push({ edge, targetFile, message });
      }
    }
  }

  console.log(
    `API module boundary check completed in ${Date.now() - startTime}ms, found ${violations.length} violations`,
  );
  return violations;
}

function checkApiModuleBoundary(
  edge: ImportEdge,
  targetFile: string,
): string | null {
  const sourceArea = classifyApiArea(toRepoPath(edge.sourceFile));
  const targetArea = classifyApiArea(toRepoPath(targetFile));

  if (!sourceArea || !targetArea) {
    return null;
  }

  if (sourceArea.kind === "unclassifiedModule") {
    return getUnclassifiedModuleMessage(sourceArea);
  }

  if (targetArea.kind === "unclassifiedModule") {
    return getUnclassifiedModuleMessage(targetArea);
  }

  if (!isApiAreaImportAllowed(sourceArea, targetArea)) {
    return getApiAreaViolationMessage(sourceArea, targetArea);
  }

  if (sourceArea.kind === "module" && targetArea.kind === "module") {
    if (sourceArea.moduleName !== targetArea.moduleName) {
      return "API modules must not import other API modules.";
    }

    if (!isModuleLayerImportAllowed(sourceArea.layer, targetArea.layer)) {
      return "Same-module imports must point toward lower layers: routes -> middleware -> services -> repositories -> utils -> types.";
    }
  }

  return null;
}

function isApiAreaImportAllowed(
  sourceArea: ApiArea,
  targetArea: ApiArea,
): boolean {
  return apiAreaImportGraph[sourceArea.kind].includes(targetArea.kind);
}

function getApiAreaViolationMessage(
  sourceArea: ApiArea,
  targetArea: ApiArea,
): string {
  if (sourceArea.kind === "shared" && targetArea.kind === "module") {
    return `${API_SHARED_ROOT} must not import API modules.`;
  }

  if (sourceArea.kind === "module") {
    return `API modules can only import their own module, ${API_SHARED_ROOT}, or workspace packages.`;
  }

  return `API ${sourceArea.kind} code cannot import API ${targetArea.kind} code.`;
}

function getUnclassifiedModuleMessage(
  area: Extract<ApiArea, { kind: "unclassifiedModule" }>,
): string {
  return `API module file ${area.repoPath} is not in a known layer: routes, middleware, services/providers, repositories, utils, or types.`;
}

function isModuleLayerImportAllowed(
  sourceLayer: ApiModuleLayer,
  targetLayer: ApiModuleLayer,
): boolean {
  return moduleLayerImportGraph[sourceLayer].includes(targetLayer);
}

function classifyApiArea(repoPath: string): ApiArea | null {
  if (!repoPath.startsWith(API_SERVER_SRC_PREFIX)) {
    return null;
  }

  if (repoPath.startsWith(API_SHARED_PREFIX)) {
    return { kind: "shared" };
  }

  if (!repoPath.startsWith(API_MODULES_PREFIX)) {
    return { kind: "root" };
  }

  const moduleMatch = repoPath.match(API_MODULES_PATTERN);
  if (!moduleMatch) {
    return { kind: "root" };
  }

  const layer = classifyApiModuleLayer(moduleMatch[2]!);
  if (!layer) {
    return {
      kind: "unclassifiedModule",
      moduleName: moduleMatch[1]!,
      repoPath,
    };
  }

  return {
    kind: "module",
    moduleName: moduleMatch[1]!,
    layer,
  };
}

function classifyApiModuleLayer(rest: string): ApiModuleLayer | null {
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

  return null;
}

function printViolations(violations: BoundaryViolation[]): void {
  console.error(
    `API module boundary check failed with ${violations.length} violation${violations.length === 1 ? "" : "s"}.\n`,
  );

  for (const violation of violations) {
    console.error(
      `${toRepoPath(violation.edge.sourceFile)}:${violation.edge.line}:${violation.edge.column}`,
    );
    console.error(
      `  ${violation.edge.kind} "${violation.edge.specifier}" resolves to ${toRepoPath(violation.targetFile)}`,
    );
    console.error(`  ${violation.message}\n`);
  }
}

const violations = checkBoundaries();
if (violations.length > 0) {
  printViolations(violations);
  process.exitCode = 1;
}
