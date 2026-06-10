import type { z } from "zod";

/**
 * Intermediate representation for Swift code generation.
 *
 * The introspector lowers Zod schemas (via JSON Schema) into this IR; the
 * emitter renders it as Swift source. Keeping the IR small and explicit makes
 * unsupported Zod constructs fail loudly at introspection time instead of
 * producing subtly wrong Swift.
 */

export type SwiftTypeRef =
  | { kind: "string" }
  | { kind: "int" }
  | { kind: "double" }
  | { kind: "bool" }
  | { kind: "uuid" }
  /** ISO 8601 timestamp transported as a string (`ISODateTimeString`). */
  | { kind: "datetime" }
  /** Opaque JSON (`JSONValue` support type). */
  | { kind: "json" }
  | { kind: "array"; element: SwiftTypeRef }
  | { kind: "dictionary"; value: SwiftTypeRef }
  /** Reference to another generated declaration (top-level or nested). */
  | { kind: "named"; name: string }
  | { kind: "optional"; wrapped: SwiftTypeRef };

export type IRProperty = {
  /** Key as it appears on the wire. */
  jsonKey: string;
  /** Swift property name (post-rename, pre-escaping). */
  swiftName: string;
  type: SwiftTypeRef;
  doc?: string;
  /**
   * Literal pinned by the schema (`z.literal`). Emitted as a `let` with a
   * default value: encoded on the wire, skipped during decoding.
   */
  constValue?: string | number | boolean;
  /** Swift expression used as the memberwise-init default, e.g. `nil`, `.high`, `8192`. */
  initDefault?: string;
};

export type IRStruct = {
  kind: "struct";
  name: string;
  doc?: string;
  properties: IRProperty[];
  /** Synthesized declarations for inline objects/enums, nested inside this struct. */
  nested: IRDecl[];
};

export type IREnumCase = { name: string; rawValue: string };

export type IREnum = {
  kind: "enum";
  name: string;
  doc?: string;
  cases: IREnumCase[];
  /** Adds `.unknown(String)` so new server values decode instead of failing. */
  nonFrozen: boolean;
};

export type IRUnionVariant = {
  caseName: string;
  /** Swift type of the associated payload. */
  typeName: string;
  discriminatorValue: string;
};

export type IRUnion = {
  kind: "union";
  name: string;
  doc?: string;
  discriminatorKey: string;
  variants: IRUnionVariant[];
  /** Synthesized payload structs for inline (unregistered) variants. */
  nested: IRDecl[];
  /** Adds `.unknown(type: String)` so new server variants decode instead of failing. */
  nonFrozen: boolean;
};

export type IRTypeAlias = {
  kind: "alias";
  name: string;
  doc?: string;
  target: SwiftTypeRef;
};

export type IRDecl = IRStruct | IREnum | IRUnion | IRTypeAlias;

/** One schema selected for generation. */
export type ManifestEntry = {
  /** The Zod schema object exported from src/types. */
  schema: z.ZodType;
  /** Swift type name; also the registry id used for cross-references. */
  swiftName: string;
  /** Output grouping: one generated Swift file per group. */
  group: string;
  /**
   * Decode-tolerant mode for server-evolving enums/unions: unrecognized raw
   * values or union variants decode into an `.unknown` case instead of
   * throwing. Use for everything the server may extend before old app builds
   * die out. Has no effect on structs.
   */
  nonFrozen?: boolean;
  /** Wire key → Swift property name renames (reserved words, Swift style). */
  renames?: Record<string, string>;
  /** Documentation override; falls back to the schema's `.describe()`. */
  doc?: string;
};

export type GeneratedFile = {
  /** Path relative to the output root. */
  path: string;
  content: string;
};
