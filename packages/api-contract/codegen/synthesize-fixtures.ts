import type { z } from "zod";
import type { ManifestEntry } from "./ir";
import type { JSONSchema } from "./introspect";
import { pascalCase, refId } from "./introspect";

/**
 * Synthesizes wire fixtures for every manifest type directly from its JSON
 * Schema, so adding an API type requires no hand-written fixture:
 *
 * - structs get an `autoFull` sample (every property present) and an
 *   `autoMinimal` sample (required properties only, nullables null);
 * - discriminated unions get one sample per variant.
 *
 * Independence from the Swift generator is preserved by the parse gate in
 * generate.ts: every synthesized value is validated with the REAL Zod schema
 * before it is written, so a misreading in the introspector produces either a
 * generation failure or a fixture that contradicts the wrong Swift type —
 * never a quietly self-consistent test.
 *
 * Hand-written fixtures (fixtures.ts) remain for realism the synthesizer
 * cannot invent (actual AI SDK message parts, populated session state).
 */

export type AutoFixture = {
  schema: z.ZodType;
  typeName: string;
  caseName: string;
  value: unknown;
  /**
   * Whether parse failure aborts generation. Minimal samples may legitimately
   * violate `.refine` constraints (which JSON Schema cannot express) and are
   * skipped instead.
   */
  mustParse: boolean;
};

type Mode = "full" | "minimal";

const UUID_SAMPLE = "7e3f9a52-0c4e-4b7a-9b1e-6d2f8c5a1b3d";
const DATETIME_SAMPLE = "2026-06-10T12:00:00Z";
/** Candidates tried in order against `pattern` constraints. */
const PATTERN_CANDIDATES = [
  "sample",
  "SAMPLE_VAR",
  "a.example.com",
  "*.example.com",
  "https://example.com",
  "1",
];

export function synthesizeFixtures(
  entries: ManifestEntry[],
  schemas: Record<string, JSONSchema>,
): AutoFixture[] {
  const fixtures: AutoFixture[] = [];

  for (const entry of entries) {
    const node = requireSchema(schemas, entry.swiftName);
    if (node.oneOf) {
      for (const branch of node.oneOf as JSONSchema[]) {
        const variantName = refId(branch);
        const variantNode = variantName ? requireSchema(schemas, variantName) : branch;
        const discriminator = discriminatorValue(variantNode);
        fixtures.push({
          schema: entry.schema,
          typeName: entry.swiftName,
          caseName: `auto${pascalCase(discriminator)}`,
          value: sample(variantNode, schemas, "full", entry.swiftName, []),
          mustParse: true,
        });
      }
      continue;
    }
    if (node.type === "object" && node.properties) {
      fixtures.push({
        schema: entry.schema,
        typeName: entry.swiftName,
        caseName: "autoFull",
        value: sample(node, schemas, "full", entry.swiftName, []),
        mustParse: true,
      });
      fixtures.push({
        schema: entry.schema,
        typeName: entry.swiftName,
        caseName: "autoMinimal",
        value: sample(node, schemas, "minimal", entry.swiftName, []),
        mustParse: false,
      });
    }
    // Enums and aliases are exercised wherever structs embed them.
  }

  return fixtures;
}

/** First string const found among the variant's properties (its discriminator). */
function discriminatorValue(variantNode: JSONSchema): string {
  for (const property of Object.values(
    (variantNode.properties as Record<string, JSONSchema> | undefined) ?? {},
  )) {
    if (typeof property.const === "string") {
      return property.const;
    }
  }
  throw new Error(`Union variant without a string discriminator: ${JSON.stringify(variantNode)}`);
}

function sample(
  node: JSONSchema,
  schemas: Record<string, JSONSchema>,
  mode: Mode,
  path: string,
  stack: string[],
): unknown {
  const ref = refId(node);
  if (ref) {
    if (stack.includes(ref)) {
      throw new Error(`${path}: cannot synthesize a sample for recursive schema ${ref}`);
    }
    return sample(requireSchema(schemas, ref), schemas, mode, path, [...stack, ref]);
  }

  const nullable = unwrapNullable(node);
  if (nullable) {
    return mode === "minimal" ? null : sample(nullable, schemas, mode, path, stack);
  }

  if (node.const !== undefined) {
    return node.const;
  }
  if (Array.isArray(node.enum)) {
    return node.enum[0];
  }
  const firstBranch = (node.oneOf as JSONSchema[] | undefined)?.[0];
  if (firstBranch) {
    return sample(firstBranch, schemas, mode, path, stack);
  }

  switch (node.type) {
    case "string":
      return sampleString(node, path);
    case "integer":
    case "number":
      return sampleNumber(node);
    case "boolean":
      return true;
    case "array": {
      const count = Math.max((node.minItems as number | undefined) ?? 1, 1);
      const element = sample(node.items ?? {}, schemas, mode, path, stack);
      return Array.from({ length: count }, () => element);
    }
    case "object": {
      if (node.properties) {
        const required = new Set<string>((node.required as string[] | undefined) ?? []);
        const result: Record<string, unknown> = {};
        for (const [key, property] of Object.entries(
          node.properties as Record<string, JSONSchema>,
        )) {
          if (mode === "minimal" && !required.has(key)) {
            continue;
          }
          result[key] = sample(property, schemas, mode, `${path}.${key}`, stack);
        }
        return result;
      }
      if (node.additionalProperties) {
        const key = node.propertyNames?.pattern
          ? matchingCandidate(node.propertyNames.pattern as string, path)
          : "key";
        return { [key]: sample(node.additionalProperties, schemas, mode, path, stack) };
      }
      return { opaque: true };
    }
    case undefined:
      // z.unknown()/z.any(): an object exercises JSONValue's hardest path.
      return { opaque: true };
    default:
      throw new Error(`${path}: cannot synthesize a sample for ${JSON.stringify(node)}`);
  }
}

function sampleString(node: JSONSchema, path: string): string {
  if (node.format === "uuid") {
    return UUID_SAMPLE;
  }
  if (node.format === "date-time") {
    return DATETIME_SAMPLE;
  }
  let value = node.pattern ? matchingCandidate(node.pattern as string, path) : "sample";
  const minLength = (node.minLength as number | undefined) ?? 0;
  if (value.length < minLength) {
    value = value.padEnd(minLength, "x");
  }
  const maxLength = node.maxLength as number | undefined;
  if (maxLength !== undefined && value.length > maxLength) {
    value = value.slice(0, maxLength);
  }
  return value;
}

function sampleNumber(node: JSONSchema): number {
  let value = 1;
  const minimum = node.minimum as number | undefined;
  const exclusiveMinimum = node.exclusiveMinimum as number | undefined;
  if (minimum !== undefined) {
    value = Math.max(value, minimum);
  }
  if (exclusiveMinimum !== undefined) {
    value = Math.max(value, exclusiveMinimum + 1);
  }
  const maximum = node.maximum as number | undefined;
  if (maximum !== undefined) {
    value = Math.min(value, maximum);
  }
  return node.type === "integer" ? Math.round(value) : value;
}

function matchingCandidate(pattern: string, path: string): string {
  const regex = new RegExp(pattern);
  const match = PATTERN_CANDIDATES.find((candidate) => regex.test(candidate));
  if (!match) {
    throw new Error(
      `${path}: no sample candidate matches pattern ${pattern}; ` +
        "add a hand-written fixture for this type in fixtures.ts",
    );
  }
  return match;
}

function requireSchema(schemas: Record<string, JSONSchema>, name: string): JSONSchema {
  const node = schemas[name];
  if (!node) {
    throw new Error(`No JSON Schema for ${name}`);
  }
  return node;
}

/** Local copy of the nullable shape check (anyOf [T, null]). */
function unwrapNullable(node: JSONSchema): JSONSchema | undefined {
  const anyOf = node.anyOf as JSONSchema[] | undefined;
  if (!anyOf || anyOf.length !== 2) {
    return undefined;
  }
  const nullBranch = anyOf.find((branch) => branch.type === "null");
  const valueBranch = anyOf.find((branch) => branch !== nullBranch);
  return nullBranch ? valueBranch : undefined;
}
