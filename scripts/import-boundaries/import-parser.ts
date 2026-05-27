import ts from "typescript";
import type { ImportEdge, ImportKind } from "./types";

export function extractImports(sourceFilePath: string): ImportEdge[] {
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
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    edges.push({
      sourceFile: sourceFilePath,
      specifier,
      kind,
      line: position.line + 1,
      column: position.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      addEdge(
        node.moduleSpecifier.text,
        node.moduleSpecifier,
        node.importClause?.isTypeOnly ? "import type" : "static import",
      );
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      addEdge(
        node.moduleSpecifier.text,
        node.moduleSpecifier,
        node.isTypeOnly ? "import type" : "re-export",
      );
    } else if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        && firstArgument
        && ts.isStringLiteral(firstArgument)
      ) {
        addEdge(firstArgument.text, firstArgument, "dynamic import");
      } else if (
        ts.isIdentifier(node.expression)
        && node.expression.text === "require"
        && firstArgument
        && ts.isStringLiteral(firstArgument)
      ) {
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
