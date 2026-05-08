/**
 * Compute a small unified line diff between two strings.
 *
 * The output is a `git diff`-style line-prefixed diff body (no file headers):
 *   - " " unchanged line
 *   - "-" line in `oldText` not in `newText`
 *   - "+" line in `newText` not in `oldText`
 *
 * Implementation: longest-common-subsequence over lines, then a single pass
 * emitting prefixed lines. Suitable for short snippets (Claude `Edit` /
 * `MultiEdit` payloads); we don't need full unified-diff hunks here.
 */
export function lineDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lcs = buildLcsTable(oldLines, newLines);
  const out: string[] = [];

  let oldIndex = oldLines.length;
  let newIndex = newLines.length;
  const ops: string[] = [];

  while (oldIndex > 0 && newIndex > 0) {
    if (oldLines[oldIndex - 1] === newLines[newIndex - 1]) {
      ops.push(` ${oldLines[oldIndex - 1]}`);
      oldIndex--;
      newIndex--;
    } else if (lcs[oldIndex - 1]![newIndex]! >= lcs[oldIndex]![newIndex - 1]!) {
      ops.push(`-${oldLines[oldIndex - 1]}`);
      oldIndex--;
    } else {
      ops.push(`+${newLines[newIndex - 1]}`);
      newIndex--;
    }
  }
  while (oldIndex > 0) {
    ops.push(`-${oldLines[oldIndex - 1]}`);
    oldIndex--;
  }
  while (newIndex > 0) {
    ops.push(`+${newLines[newIndex - 1]}`);
    newIndex--;
  }

  out.push(...ops.reverse());
  return out.join("\n");
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
      } else {
        table[i]![j] = Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
  }
  return table;
}
