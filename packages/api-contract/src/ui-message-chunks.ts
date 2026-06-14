import { z } from "zod/v4";
import {
  JSONPayloadSchema,
  openDiscriminatorSchema,
  ProviderMetadataSchema,
  type OpenUnionConfig,
} from "./ui-message-common";

const FinishReasonSchema = z.enum([
  "length",
  "error",
  "stop",
  "content-filter",
  "tool-calls",
  "other",
]);

const TextStartChunkSchema = z.strictObject({
  type: z.literal("text-start"),
  id: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const TextDeltaChunkSchema = z.strictObject({
  type: z.literal("text-delta"),
  id: z.string(),
  delta: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const TextEndChunkSchema = z.strictObject({
  type: z.literal("text-end"),
  id: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ReasoningStartChunkSchema = z.strictObject({
  type: z.literal("reasoning-start"),
  id: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ReasoningDeltaChunkSchema = z.strictObject({
  type: z.literal("reasoning-delta"),
  id: z.string(),
  delta: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ReasoningEndChunkSchema = z.strictObject({
  type: z.literal("reasoning-end"),
  id: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const ErrorChunkSchema = z.strictObject({
  type: z.literal("error"),
  errorText: z.string(),
});

const ToolInputStartChunkSchema = z.strictObject({
  type: z.literal("tool-input-start"),
  toolCallId: z.string(),
  toolName: z.string(),
  providerExecuted: z.boolean().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
  dynamic: z.boolean().optional(),
  title: z.string().optional(),
});

const ToolInputDeltaChunkSchema = z.strictObject({
  type: z.literal("tool-input-delta"),
  toolCallId: z.string(),
  inputTextDelta: z.string(),
});

const ToolInputAvailableChunkSchema = z.strictObject({
  type: z.literal("tool-input-available"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: JSONPayloadSchema,
  providerExecuted: z.boolean().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
  dynamic: z.boolean().optional(),
  title: z.string().optional(),
});

const ToolInputErrorChunkSchema = z.strictObject({
  type: z.literal("tool-input-error"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: JSONPayloadSchema,
  providerExecuted: z.boolean().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
  dynamic: z.boolean().optional(),
  errorText: z.string(),
  title: z.string().optional(),
});

const ToolApprovalRequestChunkSchema = z.strictObject({
  type: z.literal("tool-approval-request"),
  approvalId: z.string(),
  toolCallId: z.string(),
});

const ToolOutputAvailableChunkSchema = z.strictObject({
  type: z.literal("tool-output-available"),
  toolCallId: z.string(),
  output: JSONPayloadSchema,
  providerExecuted: z.boolean().optional(),
  dynamic: z.boolean().optional(),
  preliminary: z.boolean().optional(),
});

const ToolOutputErrorChunkSchema = z.strictObject({
  type: z.literal("tool-output-error"),
  toolCallId: z.string(),
  errorText: z.string(),
  providerExecuted: z.boolean().optional(),
  dynamic: z.boolean().optional(),
});

const ToolOutputDeniedChunkSchema = z.strictObject({
  type: z.literal("tool-output-denied"),
  toolCallId: z.string(),
});

const SourceUrlChunkSchema = z.strictObject({
  type: z.literal("source-url"),
  sourceId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const SourceDocumentChunkSchema = z.strictObject({
  type: z.literal("source-document"),
  sourceId: z.string(),
  mediaType: z.string(),
  title: z.string(),
  filename: z.string().optional(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const FileChunkSchema = z.strictObject({
  type: z.literal("file"),
  url: z.string(),
  mediaType: z.string(),
  providerMetadata: ProviderMetadataSchema.optional(),
});

const DataChunkSchema = z.strictObject({
  type: z.string().startsWith("data-"),
  id: z.string().optional(),
  data: JSONPayloadSchema,
  transient: z.boolean().optional(),
});

const StartStepChunkSchema = z.strictObject({
  type: z.literal("start-step"),
});

const FinishStepChunkSchema = z.strictObject({
  type: z.literal("finish-step"),
});

const StartChunkSchema = z.strictObject({
  type: z.literal("start"),
  messageId: z.string().optional(),
  messageMetadata: JSONPayloadSchema.optional(),
});

const FinishChunkSchema = z.strictObject({
  type: z.literal("finish"),
  finishReason: FinishReasonSchema.optional(),
  messageMetadata: JSONPayloadSchema.optional(),
});

const AbortChunkSchema = z.strictObject({
  type: z.literal("abort"),
  reason: z.string().optional(),
});

const MessageMetadataChunkSchema = z.strictObject({
  type: z.literal("message-metadata"),
  messageMetadata: JSONPayloadSchema,
});

type TextStartChunk = z.infer<typeof TextStartChunkSchema>;
type TextDeltaChunk = z.infer<typeof TextDeltaChunkSchema>;
type TextEndChunk = z.infer<typeof TextEndChunkSchema>;
type ReasoningStartChunk = z.infer<typeof ReasoningStartChunkSchema>;
type ReasoningDeltaChunk = z.infer<typeof ReasoningDeltaChunkSchema>;
type ReasoningEndChunk = z.infer<typeof ReasoningEndChunkSchema>;
type ErrorChunk = z.infer<typeof ErrorChunkSchema>;
type ToolInputStartChunk = z.infer<typeof ToolInputStartChunkSchema>;
type ToolInputDeltaChunk = z.infer<typeof ToolInputDeltaChunkSchema>;
type ToolInputAvailableChunk = z.infer<typeof ToolInputAvailableChunkSchema>;
type ToolInputErrorChunk = z.infer<typeof ToolInputErrorChunkSchema>;
type ToolApprovalRequestChunk = z.infer<typeof ToolApprovalRequestChunkSchema>;
type ToolOutputAvailableChunk = z.infer<typeof ToolOutputAvailableChunkSchema>;
type ToolOutputErrorChunk = z.infer<typeof ToolOutputErrorChunkSchema>;
type ToolOutputDeniedChunk = z.infer<typeof ToolOutputDeniedChunkSchema>;
type SourceUrlChunk = z.infer<typeof SourceUrlChunkSchema>;
type SourceDocumentChunk = z.infer<typeof SourceDocumentChunkSchema>;
type FileChunk = z.infer<typeof FileChunkSchema>;
type DataChunk = z.infer<typeof DataChunkSchema>;
type StartStepChunk = z.infer<typeof StartStepChunkSchema>;
type FinishStepChunk = z.infer<typeof FinishStepChunkSchema>;
type StartChunk = z.infer<typeof StartChunkSchema>;
type FinishChunk = z.infer<typeof FinishChunkSchema>;
type AbortChunk = z.infer<typeof AbortChunkSchema>;
type MessageMetadataChunk = z.infer<typeof MessageMetadataChunkSchema>;
type UnknownWireUIMessageChunk = { type: string; [key: string]: unknown };

export type WireUIMessageChunk =
  | TextStartChunk
  | TextDeltaChunk
  | TextEndChunk
  | ReasoningStartChunk
  | ReasoningDeltaChunk
  | ReasoningEndChunk
  | ErrorChunk
  | ToolInputStartChunk
  | ToolInputDeltaChunk
  | ToolInputAvailableChunk
  | ToolInputErrorChunk
  | ToolApprovalRequestChunk
  | ToolOutputAvailableChunk
  | ToolOutputErrorChunk
  | ToolOutputDeniedChunk
  | SourceUrlChunk
  | SourceDocumentChunk
  | FileChunk
  | DataChunk
  | StartStepChunk
  | FinishStepChunk
  | StartChunk
  | FinishChunk
  | AbortChunk
  | MessageMetadataChunk
  | UnknownWireUIMessageChunk;

export const UI_MESSAGE_CHUNK_OPEN_UNION = {
  discriminatorKey: "type",
  unknownRawValue: true,
  exactCases: [
    { discriminatorValue: "text-start", typeName: "TextStartUIMessageChunk", schema: TextStartChunkSchema },
    { discriminatorValue: "text-delta", typeName: "TextDeltaUIMessageChunk", schema: TextDeltaChunkSchema },
    { discriminatorValue: "text-end", typeName: "TextEndUIMessageChunk", schema: TextEndChunkSchema },
    {
      discriminatorValue: "reasoning-start",
      typeName: "ReasoningStartUIMessageChunk",
      schema: ReasoningStartChunkSchema,
    },
    {
      discriminatorValue: "reasoning-delta",
      typeName: "ReasoningDeltaUIMessageChunk",
      schema: ReasoningDeltaChunkSchema,
    },
    {
      discriminatorValue: "reasoning-end",
      typeName: "ReasoningEndUIMessageChunk",
      schema: ReasoningEndChunkSchema,
    },
    { discriminatorValue: "error", typeName: "ErrorUIMessageChunk", schema: ErrorChunkSchema },
    {
      discriminatorValue: "tool-input-start",
      typeName: "ToolInputStartUIMessageChunk",
      schema: ToolInputStartChunkSchema,
    },
    {
      discriminatorValue: "tool-input-delta",
      typeName: "ToolInputDeltaUIMessageChunk",
      schema: ToolInputDeltaChunkSchema,
    },
    {
      discriminatorValue: "tool-input-available",
      typeName: "ToolInputAvailableUIMessageChunk",
      schema: ToolInputAvailableChunkSchema,
    },
    {
      discriminatorValue: "tool-input-error",
      typeName: "ToolInputErrorUIMessageChunk",
      schema: ToolInputErrorChunkSchema,
    },
    {
      discriminatorValue: "tool-approval-request",
      typeName: "ToolApprovalRequestUIMessageChunk",
      schema: ToolApprovalRequestChunkSchema,
    },
    {
      discriminatorValue: "tool-output-available",
      typeName: "ToolOutputAvailableUIMessageChunk",
      schema: ToolOutputAvailableChunkSchema,
    },
    {
      discriminatorValue: "tool-output-error",
      typeName: "ToolOutputErrorUIMessageChunk",
      schema: ToolOutputErrorChunkSchema,
    },
    {
      discriminatorValue: "tool-output-denied",
      typeName: "ToolOutputDeniedUIMessageChunk",
      schema: ToolOutputDeniedChunkSchema,
    },
    { discriminatorValue: "source-url", typeName: "SourceUrlUIMessageChunk", schema: SourceUrlChunkSchema },
    {
      discriminatorValue: "source-document",
      typeName: "SourceDocumentUIMessageChunk",
      schema: SourceDocumentChunkSchema,
    },
    { discriminatorValue: "file", typeName: "FileUIMessageChunk", schema: FileChunkSchema },
    { discriminatorValue: "start-step", typeName: "StartStepUIMessageChunk", schema: StartStepChunkSchema },
    { discriminatorValue: "finish-step", typeName: "FinishStepUIMessageChunk", schema: FinishStepChunkSchema },
    { discriminatorValue: "start", typeName: "StartUIMessageChunk", schema: StartChunkSchema },
    { discriminatorValue: "finish", typeName: "FinishUIMessageChunk", schema: FinishChunkSchema },
    { discriminatorValue: "abort", typeName: "AbortUIMessageChunk", schema: AbortChunkSchema },
    {
      discriminatorValue: "message-metadata",
      typeName: "MessageMetadataUIMessageChunk",
      schema: MessageMetadataChunkSchema,
    },
  ],
  prefixCases: [
    { prefix: "data-", caseName: "data", typeName: "DataUIMessageChunk", schema: DataChunkSchema },
  ],
} satisfies OpenUnionConfig;

export const UIMessageChunkSchema = openDiscriminatorSchema(
  UI_MESSAGE_CHUNK_OPEN_UNION,
) as z.ZodType<WireUIMessageChunk>;
