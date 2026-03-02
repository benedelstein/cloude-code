export function dedent(
  stringsOrInput: TemplateStringsArray | string,
  ...values: unknown[]
): string {
  const rawText = typeof stringsOrInput === "string"
    ? stringsOrInput
    : String.raw({ raw: stringsOrInput }, ...values);

  const normalizedLines = rawText.replace(/\r\n/g, "\n").split("\n");

  while (normalizedLines.length > 0 && normalizedLines[0]?.trim() === "") {
    normalizedLines.shift();
  }
  while (
    normalizedLines.length > 0 &&
    normalizedLines[normalizedLines.length - 1]?.trim() === ""
  ) {
    normalizedLines.pop();
  }

  const indentationLevels = normalizedLines
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^(\s*)/)?.[1]?.length ?? 0);

  const minimumIndentation = indentationLevels.length > 0
    ? Math.min(...indentationLevels)
    : 0;

  return normalizedLines
    .map((line) => line.slice(minimumIndentation))
    .join("\n");
}
