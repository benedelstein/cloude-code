import { checkApiModuleBoundary } from "./import-boundaries/api-module-boundaries";
import { extractImports } from "./import-boundaries/import-parser";
import { resolveImportTarget } from "./import-boundaries/import-resolver";
import { checkPackageBoundary } from "./import-boundaries/package-boundaries";
import { collectSourceFiles, toRepoPath } from "./import-boundaries/path-utils";
import type { BoundaryViolation } from "./import-boundaries/types";

function checkBoundaries(): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const startTime = Date.now();

  for (const sourceFile of collectSourceFiles()) {
    for (const edge of extractImports(sourceFile)) {
      const targetFile = resolveImportTarget(sourceFile, edge.specifier);
      if (!targetFile) {
        continue;
      }

      const message =
        checkPackageBoundary(edge, targetFile)
        ?? checkApiModuleBoundary(edge, targetFile);

      if (message) {
        violations.push({ edge, targetFile, message });
      }
    }
  }

  console.log(`Import boundary check completed in ${Date.now() - startTime}ms, found ${violations.length} violations`);
  return violations;
}

function printViolations(violations: BoundaryViolation[]): void {
  console.error(
    `Import boundary check failed with ${violations.length} violation${violations.length === 1 ? "" : "s"}.\n`,
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
