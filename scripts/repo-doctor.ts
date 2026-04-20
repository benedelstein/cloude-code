import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const PACKAGE_JSON_PATHS = [
  "package.json",
  ...collectPackageJsonPaths("packages"),
  ...collectPackageJsonPaths("services"),
  ...collectPackageJsonPaths("apps"),
  "scripts/package.json",
];

const SCRIPT_FILE_PATTERN = /(^|\s)([./A-Za-z0-9_-]+\.(?:[cm]?js|tsx?))(?:\s|$)/g;

function collectPackageJsonPaths(directory: string): string[] {
  const absoluteDirectory = path.join(REPO_ROOT, directory);
  try {
    return readdirSync(absoluteDirectory)
      .map((entry) => path.join(directory, entry, "package.json"))
      .filter((candidate) => {
        try {
          return statSync(path.join(REPO_ROOT, candidate)).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

type PackageJson = {
  scripts?: Record<string, string>;
};

function getReferencedScriptFiles(command: string): string[] {
  const referencedFiles = new Set<string>();

  for (const match of command.matchAll(SCRIPT_FILE_PATTERN)) {
    const filePath = match[2];
    if (!filePath || filePath.startsWith("http")) {
      continue;
    }
    referencedFiles.add(filePath);
  }

  return [...referencedFiles];
}

function main(): void {
  const errors: string[] = [];

  for (const packageJsonPath of PACKAGE_JSON_PATHS) {
    const packageDirectory = path.dirname(packageJsonPath);
    const packageJson = JSON.parse(
      readFileSync(path.join(REPO_ROOT, packageJsonPath), "utf8"),
    ) as PackageJson;

    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
      for (const referencedFile of getReferencedScriptFiles(command)) {
        const absoluteFilePath = path.join(REPO_ROOT, packageDirectory, referencedFile);
        try {
          if (!statSync(absoluteFilePath).isFile()) {
            errors.push(`${packageJsonPath} -> scripts.${scriptName} references non-file path ${referencedFile}`);
          }
        } catch {
          errors.push(`${packageJsonPath} -> scripts.${scriptName} references missing file ${referencedFile}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("repo-doctor found problems:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`repo-doctor passed (${PACKAGE_JSON_PATHS.length} package manifests checked).`);
}

main();
