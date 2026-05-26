import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type ImportKind = "static import" | "re-export" | "dynamic import" | "import type" | "require";

interface ImportEdge {
  sourceFile: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  column: number;
}

type ApiPrivateKind =
  | "repository"
  | "provider"
  | "route"
  | "schema"
  | "service"
  | "types"
  | "other";

type ApiArea =
  | { kind: "entry" }
  | { kind: "composition" }
  | { kind: "shared" }
  | {
      kind: "module";
      moduleName: string;
      isModuleIndex: boolean;
      privateKind: ApiPrivateKind;
    }
  | { kind: "tests" }
  | { kind: "legacy"; legacyRoot: string };

interface BoundaryViolation {
  edge: ImportEdge;
  targetFile: string;
  message: string;
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

const apiLegacyRoots = [
  "services/api-server/src/routes",
  "services/api-server/src/lib",
  "services/api-server/src/repositories",
  "services/api-server/src/durable-objects",
  "services/api-server/src/middleware",
  "services/api-server/src/types",
];

const apiLegacyFiles = [
  "services/api-server/src/types.ts",
];

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
  if (!existsSync(directory)) {
    return;
  }

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
      addEdge(
        node.moduleSpecifier.text,
        node.moduleSpecifier,
        node.importClause?.isTypeOnly ? "import type" : "static import",
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge(
        node.moduleSpecifier.text,
        node.moduleSpecifier,
        node.isTypeOnly ? "import type" : "re-export",
      );
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

function classifyApiArea(filePath: string): ApiArea | null {
  const repoPath = toRepoPath(filePath);

  if (!repoPath.startsWith("services/api-server/")) {
    return null;
  }

  if (repoPath.startsWith("services/api-server/tests/") || repoPath.startsWith("services/api-server/scripts/")) {
    return { kind: "tests" };
  }

  if (repoPath === "services/api-server/src/index.ts") {
    return { kind: "entry" };
  }

  if (repoPath.startsWith("services/api-server/src/composition/")) {
    return { kind: "composition" };
  }

  for (const legacyFile of apiLegacyFiles) {
    if (repoPath === legacyFile) {
      return { kind: "legacy", legacyRoot: legacyFile };
    }
  }

  for (const legacyRoot of apiLegacyRoots) {
    if (repoPath.startsWith(`${legacyRoot}/`)) {
      return { kind: "legacy", legacyRoot };
    }
  }

  if (repoPath.startsWith("services/api-server/src/shared/")) {
    return { kind: "shared" };
  }

  const moduleMatch = repoPath.match(/^services\/api-server\/src\/modules\/([^/]+)\/(.+)$/);
  if (!moduleMatch) {
    return null;
  }

  const moduleName = moduleMatch[1]!;
  const rest = moduleMatch[2]!;
  return {
    kind: "module",
    moduleName,
    isModuleIndex: rest === "index.ts",
    privateKind: classifyApiModulePrivateKind(rest),
  };
}

function classifyApiModulePrivateKind(rest: string): ApiPrivateKind {
  const parts = rest.split("/");
  const firstPart = parts[0];
  const basename = parts[parts.length - 1] ?? rest;

  if (firstPart === "repositories") {
    return "repository";
  }

  if (basename.endsWith(".types.ts") || firstPart === "types") {
    return "types";
  }

  if (basename.endsWith(".providers.ts") || firstPart === "providers") {
    return "provider";
  }

  if (firstPart === "routes") {
    return basename.endsWith(".schema.ts") ? "schema" : "route";
  }

  if (firstPart === "services" || basename.endsWith(".service.ts")) {
    return "service";
  }

  return "other";
}

function checkApiBoundary(edge: ImportEdge, targetFile: string): string | null {
  const sourceArea = classifyApiArea(edge.sourceFile);
  const targetArea = classifyApiArea(targetFile);

  if (!sourceArea && !targetArea) {
    return null;
  }

  if (sourceArea?.kind === "tests") {
    return null;
  }

  if (sourceArea?.kind === "legacy") {
    return `API-server source file is still under the legacy ${sourceArea.legacyRoot} layout.`;
  }

  if (targetArea?.kind === "legacy") {
    return `Import resolves to legacy API-server layout ${targetArea.legacyRoot}.`;
  }

  if (sourceArea?.kind === "shared" && targetArea?.kind === "module") {
    return "API-server shared code must not import modules.";
  }

  if (sourceArea?.kind === "module" && targetArea?.kind === "module") {
    return checkModuleBoundary(sourceArea, targetArea, edge, targetFile);
  }

  if (sourceArea?.kind === "composition" && targetArea?.kind === "module") {
    if (targetArea.privateKind === "repository") {
      return "Composition must wire module services/providers, not module repositories.";
    }
    return null;
  }

  if (sourceArea?.kind === "composition" && targetArea?.kind === "shared") {
    return null;
  }

  if (sourceArea?.kind === "entry" && targetArea?.kind === "module") {
    return "API-server entrypoint must import runtime module wiring through composition.";
  }

  if (sourceArea?.kind === "module" && targetArea?.kind === "entry") {
    return "API-server modules must not import the worker entrypoint.";
  }

  return null;
}

function checkModuleBoundary(
  sourceArea: Extract<ApiArea, { kind: "module" }>,
  targetArea: Extract<ApiArea, { kind: "module" }>,
  edge: ImportEdge,
  _targetFile: string,
): string | null {
  if (sourceArea.moduleName === targetArea.moduleName) {
    if (edge.specifier.startsWith("@/modules/")) {
      return "Same-module imports must be relative, not through @/modules.";
    }

    if (sourceArea.isModuleIndex && edge.kind !== "import type") {
      return "Module index.ts must not export runtime values.";
    }

    return null;
  }

  return "API-server modules must not import other modules. Move shared types/helpers to shared/ or wire runtime dependencies through composition.";
}

function checkPackageBoundary(sourceFile: string, targetFile: string): string | null {
  const source = toRepoPath(sourceFile);
  const target = toRepoPath(targetFile);

  if (source.startsWith("packages/shared/") && !target.startsWith("packages/shared/")) {
    return "packages/shared must not import app or service packages.";
  }

  if (source.startsWith("packages/vm-agent/") && target.startsWith("services/api-server/")) {
    return "packages/vm-agent must not import api-server code.";
  }

  if (source.startsWith("apps/web/") && target.startsWith("services/api-server/")) {
    return "apps/web must not import api-server code.";
  }

  if (source.startsWith("services/api-server/src/") && target.startsWith("apps/web/")) {
    return "api-server code must not import web-client code.";
  }

  return null;
}

function checkBoundaries(): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  for (const sourceFile of collectSourceFiles()) {
    for (const edge of extractImports(sourceFile)) {
      const targetFile = resolveImportTarget(sourceFile, edge.specifier);
      if (!targetFile) {
        continue;
      }

      const message =
        checkPackageBoundary(sourceFile, targetFile)
        ?? checkApiBoundary(edge, targetFile);

      if (message) {
        violations.push({
          edge,
          targetFile,
          message,
        });
      }
    }
  }

  return violations;
}

function collectLegacyApiFiles(): string[] {
  const files: string[] = [];

  for (const legacyFile of apiLegacyFiles) {
    const absolutePath = toAbsolutePath(legacyFile);
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      files.push(legacyFile);
    }
  }

  for (const legacyRoot of apiLegacyRoots) {
    collectSourceFilesFromDirectory(toAbsolutePath(legacyRoot), files);
  }

  return files
    .map((file) => path.isAbsolute(file) ? toRepoPath(file) : file)
    .sort();
}

function printViolations(violations: BoundaryViolation[]): void {
  console.error(`Import boundary check failed with ${violations.length} violation${violations.length === 1 ? "" : "s"}.\n`);

  for (const violation of violations) {
    const sourceRepoPath = toRepoPath(violation.edge.sourceFile);
    const targetRepoPath = toRepoPath(violation.targetFile);

    console.error(`${sourceRepoPath}:${violation.edge.line}:${violation.edge.column}`);
    console.error(`  ${violation.edge.kind} "${violation.edge.specifier}" resolves to ${targetRepoPath}`);
    console.error(`  ${violation.message}\n`);
  }
}

function assertSelfCheck(name: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`Import boundary self-check failed: ${name}`);
  }
}

function selfCheckEdge(specifier: string, kind: ImportKind = "static import"): ImportEdge {
  return {
    sourceFile: toAbsolutePath("services/api-server/src/modules/session-agent/services/example.ts"),
    specifier,
    kind,
    line: 1,
    column: 1,
  };
}

function runRuleSelfChecks(): void {
  const sourceModule = {
    kind: "module" as const,
    moduleName: "session-agent",
    isModuleIndex: false,
    privateKind: "service" as const,
  };
  const gitIndex = {
    kind: "module" as const,
    moduleName: "git",
    isModuleIndex: true,
    privateKind: "other" as const,
  };
  const gitProvider = {
    kind: "module" as const,
    moduleName: "git",
    isModuleIndex: false,
    privateKind: "provider" as const,
  };
  const gitService = {
    kind: "module" as const,
    moduleName: "git",
    isModuleIndex: false,
    privateKind: "service" as const,
  };
  const sameModuleProvider = {
    kind: "module" as const,
    moduleName: "session-agent",
    isModuleIndex: false,
    privateKind: "provider" as const,
  };
  const moduleIndex = {
    kind: "module" as const,
    moduleName: "auth",
    isModuleIndex: true,
    privateKind: "other" as const,
  };
  const sameModuleRoute = {
    kind: "module" as const,
    moduleName: "auth",
    isModuleIndex: false,
    privateKind: "route" as const,
  };

  assertSelfCheck(
    "rejects cross-module runtime index imports",
    checkModuleBoundary(
      sourceModule,
      gitIndex,
      selfCheckEdge("@/modules/git"),
      toAbsolutePath("services/api-server/src/modules/git/index.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "rejects explicit cross-module service imports",
    checkModuleBoundary(
      sourceModule,
      gitService,
      selfCheckEdge("@/modules/git/services/git-proxy.service"),
      toAbsolutePath("services/api-server/src/modules/git/services/git-proxy.service.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "rejects cross-module deep provider imports",
    checkModuleBoundary(
      sourceModule,
      gitProvider,
      selfCheckEdge("@/modules/git/git.providers"),
      toAbsolutePath("services/api-server/src/modules/git/git.providers.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "rejects cross-module type provider imports",
    checkModuleBoundary(
      sourceModule,
      gitProvider,
      selfCheckEdge("@/modules/git/git.providers", "import type"),
      toAbsolutePath("services/api-server/src/modules/git/git.providers.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "allows same-module relative provider imports",
    checkModuleBoundary(
      sourceModule,
      sameModuleProvider,
      selfCheckEdge("./session-agent.providers"),
      toAbsolutePath("services/api-server/src/modules/session-agent/session-agent.providers.ts"),
    ) === null,
  );
  assertSelfCheck(
    "rejects same-module alias imports",
    checkModuleBoundary(
      sourceModule,
      sameModuleProvider,
      selfCheckEdge("@/modules/session-agent/session-agent.providers"),
      toAbsolutePath("services/api-server/src/modules/session-agent/session-agent.providers.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "rejects route exports from module public index",
    checkModuleBoundary(
      moduleIndex,
      sameModuleRoute,
      selfCheckEdge("./routes/auth.routes", "re-export"),
      toAbsolutePath("services/api-server/src/modules/auth/routes/auth.routes.ts"),
    ) !== null,
  );
  assertSelfCheck(
    "rejects worker entrypoint direct route imports",
    checkApiBoundary(
      {
        sourceFile: toAbsolutePath("services/api-server/src/index.ts"),
        specifier: "@/modules/auth/routes/auth.routes",
        kind: "static import",
        line: 1,
        column: 1,
      },
      toAbsolutePath("services/api-server/src/modules/auth/routes/auth.routes.ts"),
    ) !== null,
  );
}

runRuleSelfChecks();

const violations = checkBoundaries();
const legacyApiFiles = collectLegacyApiFiles();

if (violations.length > 0) {
  printViolations(violations);
  process.exitCode = 1;
} else {
  console.log("Import boundary check passed.");
}

if (legacyApiFiles.length > 0) {
  console.error("API-server files must live under src/modules or src/shared:");
  for (const file of legacyApiFiles) {
    console.error(`  ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log("API-server module layout check passed.");
}
