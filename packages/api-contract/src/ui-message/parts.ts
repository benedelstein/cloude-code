import { z } from "zod/v4";
import {
  JSONPayloadSchema,
  openDiscriminatorSchema,
  ProviderMetadataSchema,
  ToolApprovalSchema,
  ToolInvocationStateSchema,
  type OpenUnionConfig,
} from "./common";

const TextUIPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
  state: z.enum(["streaming", "done"]).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ReasoningUIPartSchema = z.looseObject({
  type: z.literal("reasoning"),
  text: z.string(),
  state: z.enum(["streaming", "done"]).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const SourceUrlUIPartSchema = z.looseObject({
  type: z.literal("source-url"),
  sourceId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const SourceDocumentUIPartSchema = z.looseObject({
  type: z.literal("source-document"),
  sourceId: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const FileUIPartSchema = z.looseObject({
  type: z.literal("file"),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const StepStartUIPartSchema = z.looseObject({
  type: z.literal("step-start"),
});

const DataUIPartSchema = z.looseObject({
  type: z.string().startsWith("data-"),
  id: z.string().optional(),
  data: JSONPayloadSchema,
});

const ToolUIPartSchema = z.looseObject({
  type: z.string().startsWith("tool-"),
  toolCallId: z.string(),
  title: z.string().optional(),
  state: ToolInvocationStateSchema,
  input: JSONPayloadSchema.optional(),
  output: JSONPayloadSchema.optional(),
  rawInput: JSONPayloadSchema.optional(),
  errorText: z.string().optional(),
  providerExecuted: z.boolean().optional(),
  callProviderMetadata: ProviderMetadataSchema.optional(),
  resultProviderMetadata: ProviderMetadataSchema.optional(),
  preliminary: z.boolean().optional(),
  approval: ToolApprovalSchema.optional(),
});

const DynamicToolUIPartSchema = z.looseObject({
  type: z.literal("dynamic-tool"),
  toolName: z.string(),
  toolCallId: z.string(),
  title: z.string().optional(),
  providerExecuted: z.boolean().optional(),
  state: ToolInvocationStateSchema,
  input: JSONPayloadSchema.optional(),
  output: JSONPayloadSchema.optional(),
  errorText: z.string().optional(),
  callProviderMetadata: ProviderMetadataSchema.optional(),
  resultProviderMetadata: ProviderMetadataSchema.optional(),
  preliminary: z.boolean().optional(),
  approval: ToolApprovalSchema.optional(),
});

type TextUIPart = z.infer<typeof TextUIPartSchema>;
type ReasoningUIPart = z.infer<typeof ReasoningUIPartSchema>;
type SourceUrlUIPart = z.infer<typeof SourceUrlUIPartSchema>;
type SourceDocumentUIPart = z.infer<typeof SourceDocumentUIPartSchema>;
type FileUIPart = z.infer<typeof FileUIPartSchema>;
type StepStartUIPart = z.infer<typeof StepStartUIPartSchema>;
type DataUIPart = z.infer<typeof DataUIPartSchema>;
type ToolUIPart = z.infer<typeof ToolUIPartSchema>;
type DynamicToolUIPart = z.infer<typeof DynamicToolUIPartSchema>;
type UnknownWireUIMessagePart = { type: string; [key: string]: unknown };

export type WireUIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | StepStartUIPart
  | DataUIPart
  | ToolUIPart
  | DynamicToolUIPart
  | UnknownWireUIMessagePart;

// Describes the open `WireUIMessagePart` discriminator union for runtime
// validation and Swift codegen. Exact cases are fixed AI SDK part types;
// prefix cases cover families like `data-*` and `tool-*`; unknown values keep
// their raw JSON so newer server parts do not break older clients.
export const UI_MESSAGE_PART_OPEN_UNION = {
  discriminatorKey: "type",
  unknownRawValue: true,
  exactCases: [
    { discriminatorValue: "text", typeName: "TextUIMessagePart", schema: TextUIPartSchema },
    { discriminatorValue: "reasoning", typeName: "ReasoningUIMessagePart", schema: ReasoningUIPartSchema },
    { discriminatorValue: "source-url", typeName: "SourceUrlUIMessagePart", schema: SourceUrlUIPartSchema },
    {
      discriminatorValue: "source-document",
      typeName: "SourceDocumentUIMessagePart",
      schema: SourceDocumentUIPartSchema,
    },
    { discriminatorValue: "file", typeName: "FileUIMessagePart", schema: FileUIPartSchema },
    { discriminatorValue: "step-start", typeName: "StepStartUIMessagePart", schema: StepStartUIPartSchema },
    { discriminatorValue: "dynamic-tool", typeName: "DynamicToolUIMessagePart", schema: DynamicToolUIPartSchema },
  ],
  prefixCases: [
    { prefix: "data-", caseName: "data", typeName: "DataUIMessagePart", schema: DataUIPartSchema },
    { prefix: "tool-", caseName: "tool", typeName: "ToolUIMessagePart", schema: ToolUIPartSchema },
  ],
} satisfies OpenUnionConfig;

export const WireUIMessagePartSchema = openDiscriminatorSchema(
  UI_MESSAGE_PART_OPEN_UNION,
) as z.ZodType<WireUIMessagePart>;
