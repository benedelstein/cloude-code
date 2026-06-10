import { z } from "zod";
import type {
  IRDecl,
  IREnum,
  IRProperty,
  IRStruct,
  IRUnion,
  ManifestEntry,
  SwiftTypeRef,
} from "./ir";

/**
 * Lowers the manifest's Zod schemas into IR declarations.
 *
 * Pipeline: every manifest schema is registered under its Swift name, the
 * whole registry is converted with `z.toJSONSchema` (output mode, so fields
 * with `.default()` stay required — server JSON always carries them), and the
 * resulting JSON Schemas are normalized into the Swift IR. Cross-references
 * between registered schemas surface as `$ref`s, which become Swift type
 * references; anything inline (objects, enums) is synthesized as a nested
 * declaration. Unsupported shapes throw with the offending JSON attached.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JSONSchema = Record<string, any>;

const REF_PREFIX = "defs://";

/** Converts the whole manifest into named JSON Schemas (output mode, cross-references as $refs). */
export function toJSONSchemas(entries: ManifestEntry[]): Record<string, JSONSchema> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.swiftName)) {
      throw new Error(`Duplicate manifest swiftName: ${entry.swiftName}`);
    }
    names.add(entry.swiftName);
  }

  const registry = z.registry<{ id: string }>();
  for (const entry of entries) {
    registry.add(entry.schema, { id: entry.swiftName });
  }

  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `${REF_PREFIX}${id}`,
    io: "output",
  }) as { schemas: Record<string, JSONSchema> };
  return schemas;
}

export function introspect(entries: ManifestEntry[]): Map<string, IRDecl> {
  const schemas = toJSONSchemas(entries);
  const decls = new Map<string, IRDecl>();
  for (const entry of entries) {
    const node = schemas[entry.swiftName];
    if (!node) {
      throw new Error(`No JSON Schema produced for ${entry.swiftName}`);
    }
    decls.set(entry.swiftName, lowerTopLevel(entry, node, schemas));
  }
  return decls;
}

function lowerTopLevel(
  entry: ManifestEntry,
  node: JSONSchema,
  schemas: Record<string, JSONSchema>,
): IRDecl {
  const doc = entry.doc ?? node.description;
  const context: Context = {
    schemas,
    renames: entry.renames ?? {},
    owner: entry.swiftName,
  };

  if (node.oneOf) {
    return lowerUnion(entry, node, context, doc);
  }
  if (isStringEnum(node)) {
    return lowerEnum(entry.swiftName, node, !(entry.frozen ?? false), doc);
  }
  if (node.type === "object" && node.properties) {
    return lowerStruct(entry.swiftName, node, context, doc);
  }
  if (node.type === "object" && node.additionalProperties) {
    return {
      kind: "alias",
      name: entry.swiftName,
      doc,
      target: {
        kind: "dictionary",
        value: resolve(node.additionalProperties, context, entry.swiftName).type,
      },
    };
  }
  throw new Error(
    `Unsupported top-level schema for ${entry.swiftName}: ${JSON.stringify(node)}`,
  );
}

type Context = {
  schemas: Record<string, JSONSchema>;
  renames: Record<string, string>;
  /** Top-level Swift name owning the current lowering, for error messages. */
  owner: string;
};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

function lowerStruct(
  name: string,
  node: JSONSchema,
  context: Context,
  doc?: string,
): IRStruct {
  const nested: IRDecl[] = [];
  const required = new Set<string>((node.required as string[] | undefined) ?? []);
  const properties: IRProperty[] = [];

  for (const [jsonKey, propNode] of Object.entries(
    (node.properties as Record<string, JSONSchema> | undefined) ?? {},
  )) {
    const resolved = resolve(propNode, context, jsonKey, nested);
    const isRequired = required.has(jsonKey);
    let type = resolved.type;
    if (!isRequired) {
      type = makeOptional(type);
    }

    const property: IRProperty = {
      jsonKey,
      swiftName: context.renames[jsonKey] ?? jsonKey,
      type,
      doc: resolved.doc,
    };
    if (isRequired && resolved.constValue !== undefined) {
      property.constValue = resolved.constValue;
    } else if (type.kind === "optional") {
      property.initDefault = "nil";
    } else if (resolved.initDefault !== undefined) {
      property.initDefault = resolved.initDefault;
    }
    properties.push(property);
  }

  assertUniqueNames(nested, `Struct ${name}`);
  return { kind: "struct", name, doc, properties, nested };
}

/** Synthesized nested types must not collide (e.g. two keys camel-casing to one Pascal name). */
function assertUniqueNames(decls: IRDecl[], where: string): void {
  const seen = new Set<string>();
  for (const decl of decls) {
    if (seen.has(decl.name)) {
      throw new Error(`${where}: nested type name collision for "${decl.name}"`);
    }
    seen.add(decl.name);
  }
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

function isStringEnum(node: JSONSchema): boolean {
  return Array.isArray(node.enum) && node.enum.every((value: unknown) => typeof value === "string");
}

function lowerEnum(name: string, node: JSONSchema, nonFrozen: boolean, doc?: string): IREnum {
  const cases = (node.enum as string[]).map((rawValue) => ({
    name: swiftCaseName(rawValue),
    rawValue,
  }));
  const seen = new Set<string>();
  for (const enumCase of cases) {
    if (seen.has(enumCase.name)) {
      throw new Error(`Enum ${name}: case name collision for "${enumCase.name}"`);
    }
    seen.add(enumCase.name);
  }
  return { kind: "enum", name, doc, cases, nonFrozen };
}

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

function lowerUnion(
  entry: ManifestEntry,
  node: JSONSchema,
  context: Context,
  doc?: string,
): IRUnion {
  // The discriminator key is read off the live Zod schema: it is exact, while
  // recovering it from JSON Schema would be heuristic. Zod internal — path
  // verified against zod 4.3.6; a Zod upgrade that moves it fails loudly below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discriminatorKey = (entry.schema as any)._zod?.def?.discriminator as string | undefined;
  if (!discriminatorKey) {
    throw new Error(`Union ${entry.swiftName}: only z.discriminatedUnion is supported`);
  }

  const nested: IRDecl[] = [];
  const variants = (node.oneOf as JSONSchema[]).map((branch) => {
    const refName = refId(branch);
    const variantNode = refName ? context.schemas[refName] : branch;
    if (!variantNode?.properties) {
      throw new Error(
        `Union ${entry.swiftName}: variant is not an object schema: ${JSON.stringify(branch)}`,
      );
    }
    const constValue = variantNode.properties[discriminatorKey]?.const;
    if (typeof constValue !== "string") {
      throw new Error(
        `Union ${entry.swiftName}: variant discriminator "${discriminatorKey}" must be a string literal`,
      );
    }
    let typeName = refName;
    if (!typeName) {
      typeName = pascalCase(constValue);
      nested.push(lowerStruct(typeName, variantNode, context));
    }
    return {
      caseName: swiftCaseName(constValue),
      typeName,
      discriminatorValue: constValue,
    };
  });

  const seen = new Set<string>();
  for (const variant of variants) {
    if (seen.has(variant.caseName)) {
      throw new Error(`Union ${entry.swiftName}: case name collision for "${variant.caseName}"`);
    }
    seen.add(variant.caseName);
  }
  assertUniqueNames(nested, `Union ${entry.swiftName}`);

  return {
    kind: "union",
    name: entry.swiftName,
    doc,
    discriminatorKey,
    variants,
    nested,
    nonFrozen: !(entry.frozen ?? false),
  };
}

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

type Resolved = {
  type: SwiftTypeRef;
  doc?: string;
  constValue?: string | number | boolean;
  initDefault?: string;
};

function resolve(
  node: JSONSchema,
  context: Context,
  propName: string,
  nested?: IRDecl[],
): Resolved {
  const doc = node.description as string | undefined;

  const refName = refId(node);
  if (refName) {
    return {
      type: { kind: "named", name: refName },
      doc,
      initDefault: defaultLiteralForRef(node.default, context.schemas[refName]),
    };
  }

  const nullableInner = unwrapNullable(node);
  if (nullableInner) {
    const inner = resolve(nullableInner, context, propName, nested);
    return {
      type: makeOptional(inner.type),
      doc: doc ?? inner.doc,
      constValue: inner.constValue,
      initDefault: inner.initDefault,
    };
  }

  if (node.const !== undefined) {
    return { type: constType(node.const, context, propName), doc, constValue: node.const };
  }

  if (isStringEnum(node)) {
    if (!nested) {
      throw new Error(`${context.owner}.${propName}: inline enum in unsupported position`);
    }
    // Inline enums are server-owned vocabularies; tolerate new values.
    const enumDecl = lowerEnum(pascalCase(propName), node, true, doc);
    nested.push(enumDecl);
    return { type: { kind: "named", name: enumDecl.name }, doc };
  }

  switch (node.type) {
    case "string":
      if (node.format === "uuid") {
        return { type: { kind: "uuid" }, doc };
      }
      if (node.format === "date-time") {
        return { type: { kind: "datetime" }, doc };
      }
      return {
        type: { kind: "string" },
        doc,
        initDefault: typeof node.default === "string" ? swiftStringLiteral(node.default) : undefined,
      };
    case "integer":
      return { type: { kind: "int" }, doc, initDefault: numberDefault(node.default) };
    case "number":
      return { type: { kind: "double" }, doc, initDefault: numberDefault(node.default) };
    case "boolean":
      return {
        type: { kind: "bool" },
        doc,
        initDefault: typeof node.default === "boolean" ? String(node.default) : undefined,
      };
    case "array": {
      const element = resolve(node.items ?? {}, context, `${propName}Element`, nested);
      // Only [] is representable as a Swift init default; non-empty array
      // defaults are omitted and callers supply the value explicitly.
      return {
        type: { kind: "array", element: element.type },
        doc,
        initDefault: Array.isArray(node.default) && node.default.length === 0 ? "[]" : undefined,
      };
    }
    case "object": {
      if (node.properties) {
        if (!nested) {
          throw new Error(`${context.owner}.${propName}: inline object in unsupported position`);
        }
        const structDecl = lowerStruct(pascalCase(propName), node, context, doc);
        nested.push(structDecl);
        return { type: { kind: "named", name: structDecl.name }, doc };
      }
      if (node.additionalProperties) {
        const value = resolve(node.additionalProperties, context, `${propName}Value`, nested);
        return {
          type: { kind: "dictionary", value: value.type },
          doc,
          initDefault: isEmptyObject(node.default) ? "[:]" : undefined,
        };
      }
      return { type: { kind: "json" }, doc };
    }
    case undefined:
      // Empty schema: z.unknown()/z.any(). A `default` sibling is tolerated but
      // dropped — a JSONValue default is not representable as a Swift expression.
      if (Object.keys(node).every((key) => key === "description" || key === "default")) {
        return { type: { kind: "json" }, doc };
      }
      break;
    default:
      break;
  }

  throw new Error(
    `${context.owner}.${propName}: unsupported schema shape: ${JSON.stringify(node)}`,
  );
}

function constType(value: unknown, context: Context, propName: string): SwiftTypeRef {
  switch (typeof value) {
    case "string":
      return { kind: "string" };
    case "boolean":
      return { kind: "bool" };
    case "number":
      return Number.isInteger(value) ? { kind: "int" } : { kind: "double" };
    default:
      throw new Error(`${context.owner}.${propName}: unsupported literal ${String(value)}`);
  }
}

function defaultLiteralForRef(
  defaultValue: unknown,
  target: JSONSchema | undefined,
): string | undefined {
  if (defaultValue === undefined || !target) {
    return undefined;
  }
  if (typeof defaultValue === "string" && isStringEnum(target)) {
    return `.${swiftCaseName(defaultValue)}`;
  }
  if (isEmptyObject(defaultValue) && target.type === "object" && target.additionalProperties) {
    return "[:]";
  }
  // Complex defaults (e.g. whole-object values) are not representable as a
  // simple init default; callers pass the value explicitly.
  return undefined;
}

function numberDefault(value: unknown): string | undefined {
  return typeof value === "number" ? String(value) : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function refId(node: JSONSchema): string | undefined {
  const ref = node.$ref as string | undefined;
  if (!ref) {
    return undefined;
  }
  if (!ref.startsWith(REF_PREFIX)) {
    throw new Error(`Unexpected $ref format: ${ref}`);
  }
  return ref.slice(REF_PREFIX.length);
}

/** `anyOf: [T, {type: "null"}]` (Zod's `.nullable()`) → T, else undefined. */
function unwrapNullable(node: JSONSchema): JSONSchema | undefined {
  const anyOf = node.anyOf as JSONSchema[] | undefined;
  if (!anyOf) {
    return undefined;
  }
  if (anyOf.length !== 2) {
    throw new Error(
      `anyOf with ${anyOf.length} branches is not supported (only .nullable()); ` +
        "use z.discriminatedUnion for unions",
    );
  }
  const nullBranch = anyOf.find((branch) => branch.type === "null");
  const valueBranch = anyOf.find((branch) => branch !== nullBranch);
  if (!nullBranch || !valueBranch) {
    return undefined;
  }
  return valueBranch;
}

function makeOptional(type: SwiftTypeRef): SwiftTypeRef {
  return type.kind === "optional" ? type : { kind: "optional", wrapped: type };
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

const WORD_SPLIT = /[^A-Za-z0-9]+/;

/**
 * "session.summary.updated" → "sessionSummaryUpdated";
 * "GITHUB_AUTH_REQUIRED" → "githubAuthRequired";
 * "claude-opus-4-8[1m]" → "claudeOpus481m".
 */
export function swiftCaseName(rawValue: string): string {
  const words = rawValue
    .split(WORD_SPLIT)
    .filter(Boolean)
    // SCREAMING_SNAKE words read as plain words, not acronym soup.
    .map((word) => (/^[A-Z0-9]+$/.test(word) ? word.toLowerCase() : word));
  if (words.length === 0) {
    throw new Error(`Cannot derive a Swift case name from "${rawValue}"`);
  }
  const joined = words
    .map((word, index) => (index === 0 ? lowerFirst(word) : upperFirst(word)))
    .join("");
  return /^\d/.test(joined) ? `_${joined}` : joined;
}

export function pascalCase(value: string): string {
  return upperFirst(swiftCaseName(value).replace(/^_/, ""));
}

function lowerFirst(value: string): string {
  // Lowercase a leading acronym run as a unit: "UIMessage" → "uiMessage".
  const acronym = value.match(/^[A-Z]{2,}(?=[A-Z][a-z]|$)/);
  if (acronym) {
    return value.slice(0, acronym[0].length).toLowerCase() + value.slice(acronym[0].length);
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function swiftStringLiteral(value: string): string {
  return JSON.stringify(value);
}
