import { z } from "zod/v4";
import {
  JSONPayloadSchema,
  openDiscriminatorSchema,
  ProviderMetadataSchema,
  ToolApprovalSchema,
  ToolInvocationStateSchema,
  type OpenUnionConfig,
} from "./ui-message-common";

const TextUIPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  state: z.enum(["streaming", "done"]).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ReasoningUIPartSchema = z.strictObject({
  type: z.literal("reasoning"),
  text: z.string(),
  state: z.enum(["streaming", "done"]).optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const SourceUrlUIPartSchema = z.strictObject({
  type: z.literal("source-url"),
  sourceId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const SourceDocumentUIPartSchema = z.strictObject({
  type: z.literal("source-document"),
  sourceId: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const FileUIPartSchema = z.strictObject({
  type: z.literal("file"),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const StepStartUIPartSchema = z.strictObject({
  type: z.literal("step-start"),
});

const DataUIPartSchema = z.strictObject({
  type: z.string().startsWith("data-"),
  id: z.string().optional(),
  data: JSONPayloadSchema,
});

const ToolUIPartSchema = z.strictObject({
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

const DynamicToolUIPartSchema = z.strictObject({
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
type UnknownUIPart = { type: string; [key: string]: unknown };

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | StepStartUIPart
  | DataUIPart
  | ToolUIPart
  | DynamicToolUIPart
  | UnknownUIPart;

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

export const UIMessagePartSchema = openDiscriminatorSchema(
  UI_MESSAGE_PART_OPEN_UNION,
) as z.ZodType<UIMessagePart>;
