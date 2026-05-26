export type ImportKind =
  | "static import"
  | "re-export"
  | "dynamic import"
  | "import type"
  | "require";

export interface ImportEdge {
  sourceFile: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  column: number;
}

export interface BoundaryViolation {
  edge: ImportEdge;
  targetFile: string;
  message: string;
}
