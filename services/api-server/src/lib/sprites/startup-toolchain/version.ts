export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = value.match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareSemanticVersions(
  left: SemanticVersion,
  right: SemanticVersion,
): number {
  if (left.major !== right.major) { return left.major - right.major; }
  if (left.minor !== right.minor) { return left.minor - right.minor; }
  return left.patch - right.patch;
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseSemanticVersion(version);
  const parsedMinimum = parseSemanticVersion(minimum);
  if (!parsedVersion || !parsedMinimum) {
    return false;
  }
  return compareSemanticVersions(parsedVersion, parsedMinimum) >= 0;
}
