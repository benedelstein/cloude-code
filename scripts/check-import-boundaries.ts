import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type ImportKind = "static import" | "re-export" | "dynamic import" | "import type" | "require";

interface Layer {
  id: string;
  description: string;
  prefixes: string[];
  files?: string[];
}

interface ImportEdge {
  sourceFile: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  column: number;
}

interface BoundaryViolation {
  edge: ImportEdge;
  sourceLayer: Layer;
  targetLayer: Layer;
  targetFile: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceRoots = [
  "apps/web",
  "packages/shared",
  "packages/vm-agent",
  "services/api-server",
  "scripts",
];

const ignoredDirectories = new Set([
  ".next",
  ".turbo",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const resolvableExtensions = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".json"];
const assetExtensions = new Set([
  ".css",
  ".scss",
  ".sass",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
]);

const layers: Layer[] = [
  {
    id: "shared:types",
    description: "Shared DTOs, schemas, provider ids, and protocol types.",
    prefixes: ["packages/shared/src/types/"],
  },
  {
    id: "shared:logging",
    description: "Shared logging interfaces and implementations.",
    prefixes: ["packages/shared/src/logging/"],
  },
  {
    id: "shared:utils",
    description: "Shared generic utilities.",
    prefixes: ["packages/shared/src/utils/"],
  },
  {
    id: "shared:tool-normalization",
    description: "Shared tool-part normalization logic.",
    prefixes: ["packages/shared/src/tool-normalization/"],
  },
  {
    id: "shared:entry",
    description: "Shared package public entrypoint.",
    files: ["packages/shared/src/index.ts"],
    prefixes: [],
  },
  {
    id: "shared:tests",
    description: "Shared package tests.",
    prefixes: ["packages/shared/tests/"],
  },

  {
    id: "vm-agent:lib",
    description: "VM-agent reusable runtime libraries.",
    prefixes: ["packages/vm-agent/src/lib/"],
  },
  {
    id: "vm-agent:providers",
    description: "VM-agent provider adapters.",
    prefixes: ["packages/vm-agent/src/providers/"],
  },
  {
    id: "vm-agent:runtime",
    description: "VM-agent entrypoints and runtime wiring.",
    prefixes: ["packages/vm-agent/src/"],
  },
  {
    id: "vm-agent:tests",
    description: "VM-agent tests.",
    prefixes: ["packages/vm-agent/tests/"],
  },
  {
    id: "vm-agent:bundle",
    description: "Built vm-agent bundle artifact consumed by the API server.",
    prefixes: ["packages/vm-agent/dist/"],
  },

  {
    id: "api:types",
    description: "API-server local types.",
    prefixes: ["services/api-server/src/types/"],
  },
  {
    id: "api:repositories",
    description: "API-server D1 repositories.",
    prefixes: ["services/api-server/src/repositories/"],
  },
  {
    id: "api:utils",
    description: "API-server generic utility functions.",
    prefixes: ["services/api-server/src/lib/utils/"],
  },
  {
    id: "api:do-repositories",
    description: "Durable Object SQLite repositories.",
    prefixes: ["services/api-server/src/durable-objects/repositories/"],
  },
  {
    id: "api:lib",
    description: "API-server service and integration logic.",
    prefixes: ["services/api-server/src/lib/"],
  },
  {
    id: "api:middleware",
    description: "API-server request middleware.",
    prefixes: ["services/api-server/src/middleware/"],
  },
  {
    id: "api:do-lib",
    description: "Durable Object helper services.",
    files: ["services/api-server/src/lib/github/git-proxy.ts"],
    prefixes: ["services/api-server/src/durable-objects/lib/"],
  },
  {
    id: "api:do-runtime",
    description: "Durable Object runtime entrypoints and helpers.",
    prefixes: ["services/api-server/src/durable-objects/"],
  },
  {
    id: "api:routes",
    description: "API-server HTTP route handlers and route schemas.",
    prefixes: ["services/api-server/src/routes/"],
  },
  {
    id: "api:entry",
    description: "API-server worker entrypoint.",
    files: ["services/api-server/src/index.ts"],
    prefixes: [],
  },
  {
    id: "api:tests",
    description: "API-server tests and local scripts.",
    prefixes: ["services/api-server/tests/", "services/api-server/scripts/"],
  },

  {
    id: "web:types",
    description: "Web-client local types.",
    prefixes: ["apps/web/types/"],
  },
  {
    id: "web:lib",
    description: "Web-client reusable logic and API clients.",
    prefixes: ["apps/web/lib/"],
  },
  {
    id: "web:hooks",
    description: "Web-client React hooks.",
    prefixes: ["apps/web/hooks/"],
  },
  {
    id: "web:components",
    description: "Web-client React components.",
    prefixes: ["apps/web/components/"],
  },
  {
    id: "web:app",
    description: "Next.js app routes, pages, layouts, and route handlers.",
    prefixes: ["apps/web/app/", "apps/web/proxy.ts", "apps/web/next.config.ts"],
  },
  {
    id: "web:tests",
    description: "Web-client tests.",
    prefixes: ["apps/web/tests/"],
  },

  {
    id: "scripts:root",
    description: "Repo-local operational scripts.",
    prefixes: ["scripts/"],
  },
];

const allowedImports = defineAllowedImports({
  "shared:types": [
    "shared:types",
  ],
  "shared:logging": [
    "shared:types",
    "shared:logging",
  ],
  "shared:utils": [
    "shared:types",
    "shared:logging",
    "shared:utils",
  ],
  "shared:tool-normalization": [
    "shared:types",
    "shared:utils",
    "shared:tool-normalization",
  ],
  "shared:entry": [
    "shared:types",
    "shared:logging",
    "shared:utils",
    "shared:tool-normalization",
    "shared:entry",
  ],
  "shared:tests": [
    "shared:*",
  ],

  "vm-agent:lib": [
    "shared:entry",
    "shared:types",
    "vm-agent:lib",
  ],
  "vm-agent:providers": [
    "shared:entry",
    "shared:types",
    "vm-agent:lib",
    "vm-agent:providers",
  ],
  "vm-agent:runtime": [
    "shared:entry",
    "shared:types",
    "vm-agent:lib",
    "vm-agent:providers",
    "vm-agent:runtime",
  ],
  "vm-agent:tests": [
    "shared:*",
    "vm-agent:*",
  ],
  "vm-agent:bundle": [
    "vm-agent:bundle",
  ],

  "api:types": [
    "shared:entry",
    "shared:types",
    "api:types",
  ],
  "api:repositories": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:repositories",
  ],
  "api:utils": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
  ],
  "api:do-repositories": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:do-repositories",
  ],
  "api:lib": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:repositories",
    "api:lib",
    "api:do-runtime",
  ],
  "api:middleware": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:repositories",
    "api:lib",
    "api:middleware",
  ],
  "api:do-lib": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:lib",
    "api:do-repositories",
    "api:do-lib",
    "api:do-runtime",
    "vm-agent:bundle",
  ],
  "api:do-runtime": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:repositories",
    "api:lib",
    "api:do-repositories",
    "api:do-lib",
    "api:do-runtime",
  ],
  "api:routes": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:repositories",
    "api:lib",
    "api:middleware",
    "api:do-runtime",
    "api:routes",
  ],
  "api:entry": [
    "shared:entry",
    "shared:types",
    "api:types",
    "api:utils",
    "api:lib",
    "api:middleware",
    "api:routes",
    "api:do-runtime",
  ],
  "api:tests": [
    "shared:*",
    "api:*",
    "vm-agent:bundle",
  ],

  "web:types": [
    "shared:entry",
    "shared:types",
    "web:types",
  ],
  "web:lib": [
    "shared:entry",
    "shared:types",
    "web:types",
    "web:lib",
  ],
  "web:hooks": [
    "shared:entry",
    "shared:types",
    "web:types",
    "web:lib",
    "web:hooks",
  ],
  "web:components": [
    "shared:entry",
    "shared:types",
    "web:types",
    "web:lib",
    "web:hooks",
    "web:components",
  ],
  "web:app": [
    "shared:entry",
    "shared:types",
    "web:types",
    "web:lib",
    "web:hooks",
    "web:components",
    "web:app",
  ],
  "web:tests": [
    "shared:*",
    "web:*",
  ],

  "scripts:root": [
    "shared:entry",
    "shared:types",
    "scripts:root",
    "vm-agent:bundle",
  ],
});

const exceptions = [
  {
    from: "services/api-server/src/repositories/github-user-repo-access-cache-repository.ts",
    to: "services/api-server/src/lib/github/github-app.ts",
    reason: "temporary type-only dependency on GitHubRepositoryData until GitHub DTOs move to api:types",
  },
  {
    from: "services/api-server/src/lib/sessions/session-pull-request-service.ts",
    to: "services/api-server/src/durable-objects/session-agent-do.ts",
    reason: "service accepts a typed Durable Object stub for session PR creation",
  },
];

function defineAllowedImports(imports: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(imports).map(([from, targets]) => [from, new Set(targets)]));
}

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function toAbsolutePath(repoPath: string): string {
  return path.join(repoRoot, repoPath);
}

function collectSourceFiles(): string[] {
  const files: string[] = [];

  for (const sourceRoot of sourceRoots) {
    collectSourceFilesFromDirectory(toAbsolutePath(sourceRoot), files);
  }

  return files.sort();
}

function collectSourceFilesFromDirectory(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFilesFromDirectory(entryPath, files);
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
}

function extractImports(sourceFilePath: string): ImportEdge[] {
  const sourceText = ts.sys.readFile(sourceFilePath);
  if (!sourceText) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    sourceFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const edges: ImportEdge[] = [];

  function addEdge(specifier: string, node: ts.Node, kind: ImportKind): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    edges.push({
      sourceFile: sourceFilePath,
      specifier,
      kind,
      line: position.line + 1,
      column: position.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge(node.moduleSpecifier.text, node.moduleSpecifier, "static import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge(node.moduleSpecifier.text, node.moduleSpecifier, "re-export");
    } else if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && firstArgument && ts.isStringLiteral(firstArgument)) {
        addEdge(firstArgument.text, firstArgument, "dynamic import");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require" && firstArgument && ts.isStringLiteral(firstArgument)) {
        addEdge(firstArgument.text, firstArgument, "require");
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (
        ts.isLiteralTypeNode(argument)
        && ts.isStringLiteral(argument.literal)
      ) {
        addEdge(argument.literal.text, argument.literal, "import type");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edges;
}

function resolveImportTarget(sourceFile: string, specifier: string): string | null {
  if (isAssetImport(specifier)) {
    return null;
  }

  if (specifier.startsWith(".")) {
    return resolveAsFileOrDirectory(path.resolve(path.dirname(sourceFile), specifier));
  }

  if (specifier.startsWith("@/")) {
    return resolveAliasImport(sourceFile, specifier);
  }

  if (specifier === "@repo/shared") {
    return toAbsolutePath("packages/shared/src/index.ts");
  }

  if (specifier.startsWith("@repo/shared/")) {
    return resolveWorkspaceSubpath("packages/shared", specifier.slice("@repo/shared/".length));
  }

  if (specifier === "@repo/vm-agent") {
    return toAbsolutePath("packages/vm-agent/src/index-ndjson.ts");
  }

  if (specifier.startsWith("@repo/vm-agent/")) {
    return resolveWorkspaceSubpath("packages/vm-agent", specifier.slice("@repo/vm-agent/".length));
  }

  if (specifier === "@repo/api-server") {
    return toAbsolutePath("services/api-server/src/index.ts");
  }

  if (specifier.startsWith("@repo/api-server/")) {
    return resolveWorkspaceSubpath("services/api-server", specifier.slice("@repo/api-server/".length));
  }

  if (specifier === "@repo/web" || specifier.startsWith("@repo/web/")) {
    return resolveWorkspaceSubpath("apps/web", specifier.slice("@repo/web".length).replace(/^\//, ""));
  }

  return null;
}

function resolveWorkspaceSubpath(packageRoot: string, subpath: string): string {
  const basePath = toAbsolutePath(`${packageRoot}/${subpath}`);
  return resolveAsFileOrDirectory(basePath) ?? basePath;
}

function isAssetImport(specifier: string): boolean {
  return assetExtensions.has(path.extname(specifier));
}

function resolveAliasImport(sourceFile: string, specifier: string): string | null {
  const sourceRepoPath = toRepoPath(sourceFile);
  const aliasPath = specifier.slice(2);

  if (sourceRepoPath.startsWith("apps/web/")) {
    return resolveAsFileOrDirectory(toAbsolutePath(`apps/web/${aliasPath}`));
  }

  if (sourceRepoPath.startsWith("services/api-server/")) {
    return resolveAsFileOrDirectory(toAbsolutePath(`services/api-server/src/${aliasPath}`));
  }

  return null;
}

function resolveAsFileOrDirectory(basePath: string): string | null {
  for (const extension of resolvableExtensions) {
    const filePath = `${basePath}${extension}`;
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return filePath;
    }
  }

  if (existsSync(basePath) && statSync(basePath).isFile()) {
    return basePath;
  }

  if (existsSync(basePath) && statSync(basePath).isDirectory()) {
    for (const extension of resolvableExtensions) {
      const indexPath = path.join(basePath, `index${extension}`);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }
  }

  return null;
}

function getLayer(filePath: string): Layer | null {
  const repoPath = toRepoPath(filePath);

  const exactFileLayer = layers.find((layer) => layer.files?.includes(repoPath));
  if (exactFileLayer) {
    return exactFileLayer;
  }

  return layers.find((layer) => layer.prefixes.some((prefix) => repoPath.startsWith(prefix))) ?? null;
}

function isAllowed(sourceLayer: Layer, targetLayer: Layer): boolean {
  const allowedTargets = allowedImports.get(sourceLayer.id);
  if (!allowedTargets) {
    return false;
  }

  for (const allowedTarget of allowedTargets) {
    if (allowedTarget === targetLayer.id) {
      return true;
    }

    if (allowedTarget.endsWith(":*")) {
      const namespace = allowedTarget.slice(0, -1);
      if (targetLayer.id.startsWith(namespace)) {
        return true;
      }
    }
  }

  return false;
}

function isException(sourceFile: string, targetFile: string): boolean {
  const sourceRepoPath = toRepoPath(sourceFile);
  const targetRepoPath = toRepoPath(targetFile);

  return exceptions.some((exception) => exception.from === sourceRepoPath && exception.to === targetRepoPath);
}

function checkBoundaries(): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  for (const sourceFile of collectSourceFiles()) {
    const sourceLayer = getLayer(sourceFile);
    if (!sourceLayer) {
      continue;
    }

    for (const edge of extractImports(sourceFile)) {
      const targetFile = resolveImportTarget(sourceFile, edge.specifier);
      if (!targetFile) {
        continue;
      }

      const targetLayer = getLayer(targetFile);
      if (!targetLayer) {
        continue;
      }

      if (isAllowed(sourceLayer, targetLayer) || isException(sourceFile, targetFile)) {
        continue;
      }

      violations.push({
        edge,
        sourceLayer,
        targetLayer,
        targetFile,
      });
    }
  }

  return violations;
}

function printViolations(violations: BoundaryViolation[]): void {
  console.error(`Import boundary check failed with ${violations.length} violation${violations.length === 1 ? "" : "s"}.\n`);

  for (const violation of violations) {
    const sourceRepoPath = toRepoPath(violation.edge.sourceFile);
    const targetRepoPath = toRepoPath(violation.targetFile);

    console.error(`${sourceRepoPath}:${violation.edge.line}:${violation.edge.column}`);
    console.error(`  ${violation.edge.kind} "${violation.edge.specifier}" resolves to ${targetRepoPath}`);
    console.error(`  ${violation.sourceLayer.id} (${violation.sourceLayer.description})`);
    console.error(`  cannot import ${violation.targetLayer.id} (${violation.targetLayer.description})`);
    console.error("  Move shared contracts downward, add a narrow provider/service interface, or update the boundary table with an explicit rationale.\n");
  }
}

function checkApiServerLibRoot(): string[] {
  const libRoot = toAbsolutePath("services/api-server/src/lib");

  return readdirSync(libRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && sourceExtensions.has(path.extname(entry.name)))
    .map((entry) => `services/api-server/src/lib/${entry.name}`)
    .sort();
}

const violations = checkBoundaries();
const apiServerRootLibFiles = checkApiServerLibRoot();

if (violations.length > 0) {
  printViolations(violations);
  process.exitCode = 1;
} else {
  console.log("Import boundary check passed.");
}

if (apiServerRootLibFiles.length > 0) {
  console.error("API server lib files must live under a domain or provider folder:");
  for (const file of apiServerRootLibFiles) {
    console.error(`  ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log("API server lib root check passed.");
}
