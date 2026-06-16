import { z } from "zod/v4";

export type JSONPayload =
  | null
  | string
  | number
  | boolean
  | JSONPayload[]
  | { [key: string]: JSONPayload };

function isJSONPayload(value: unknown): value is JSONPayload {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) {
        return value.every(isJSONPayload);
      }
      return Object.values(value as Record<string, unknown>).every(isJSONPayload);
    default:
      return false;
  }
}

export const JSONPayloadSchema = z.unknown().refine(
  isJSONPayload,
  { message: "Expected JSON value" },
) as z.ZodType<JSONPayload>;

export const ProviderMetadataSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
);

export const ToolInvocationStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
]);

export const ToolApprovalSchema = z.strictObject({
  id: z.string(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
});

export type OpenUnionExactCase = {
  discriminatorValue: string;
  caseName?: string;
  typeName: string;
  schema: z.ZodType;
};

export type OpenUnionPrefixCase = {
  prefix: string;
  caseName: string;
  typeName: string;
  schema: z.ZodType;
};

export type OpenUnionConfig = {
  discriminatorKey: string;
  exactCases: OpenUnionExactCase[];
  prefixCases: OpenUnionPrefixCase[];
  unknownRawValue: boolean;
};

export function openDiscriminatorSchema(config: OpenUnionConfig): z.ZodType {
  const exactCases = new Map(
    config.exactCases.map((entry) => [entry.discriminatorValue, entry.schema]),
  );

  return z.looseObject({ [config.discriminatorKey]: z.string() }).superRefine((value, ctx) => {
    const discriminator = value[config.discriminatorKey];
    if (typeof discriminator !== "string") {
      return;
    }
    const schema =
      exactCases.get(discriminator) ??
      config.prefixCases.find((entry) => discriminator.startsWith(entry.prefix))?.schema;

    if (!schema) {
      return;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }
    }
  });
}
