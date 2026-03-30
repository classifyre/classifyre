import { z } from "zod";

export const assistantContextKeySchema = z.enum([
  "source.create",
  "source.edit",
  "detector.create",
  "semantic.glossary",
  "semantic.metrics",
]);

export type AssistantContextKey = z.infer<typeof assistantContextKeySchema>;

export const assistantOperationSchema = z.enum([
  "create_source",
  "update_source",
  "test_source_connection",
  "create_custom_detector",
  "train_custom_detector",
  "create_glossary_term",
  "create_metric_definition",
  "certify_metric",
]);

export type AssistantOperation = z.infer<typeof assistantOperationSchema>;

export const assistantValidationStateSchema = z.object({
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  errors: z.array(z.string()),
});

export type AssistantValidationState = z.infer<
  typeof assistantValidationStateSchema
>;

export const assistantFieldPatchSchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
});

export type AssistantFieldPatch = z.infer<typeof assistantFieldPatchSchema>;

export const assistantChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

export type AssistantChatMessage = z.infer<typeof assistantChatMessageSchema>;

export const assistantPageContextSchema = z.object({
  key: assistantContextKeySchema,
  route: z.string().min(1),
  title: z.string().min(1),
  entityId: z.string().nullable().optional(),
  values: z.record(z.string(), z.unknown()),
  schema: z.record(z.string(), z.unknown()).nullable().optional(),
  validation: assistantValidationStateSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  supportedOperations: z.array(assistantOperationSchema),
});

export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

export const assistantPendingConfirmationSchema = z.object({
  operation: assistantOperationSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
});

export type AssistantPendingConfirmation = z.infer<
  typeof assistantPendingConfirmationSchema
>;

const assistantToastActionSchema = z.object({
  type: z.literal("show_toast"),
  tone: z.enum(["info", "success", "error"]).default("info"),
  title: z.string().min(1),
  description: z.string().optional(),
});

const assistantPatchFieldsActionSchema = z.object({
  type: z.literal("patch_fields"),
  patches: z.array(assistantFieldPatchSchema).min(1),
});

const assistantSyncSourceActionSchema = z.object({
  type: z.literal("sync_source"),
  sourceId: z.string().uuid(),
  values: z.record(z.string(), z.unknown()),
  schedule: z
    .object({
      enabled: z.boolean(),
      cron: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

const assistantSyncDetectorActionSchema = z.object({
  type: z.literal("sync_detector"),
  detectorId: z.string().uuid(),
  values: z.record(z.string(), z.unknown()),
});

const assistantSyncGlossaryTermActionSchema = z.object({
  type: z.literal("sync_glossary_term"),
  termId: z.string(),
  values: z.record(z.string(), z.unknown()),
});

const assistantSyncMetricActionSchema = z.object({
  type: z.literal("sync_metric"),
  metricId: z.string(),
  values: z.record(z.string(), z.unknown()),
});

const assistantAttachResultActionSchema = z.object({
  type: z.literal("attach_result"),
  kind: z.enum(["source_test", "detector_train", "operation"]),
  title: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const assistantUiActionSchema = z.discriminatedUnion("type", [
  assistantToastActionSchema,
  assistantPatchFieldsActionSchema,
  assistantSyncSourceActionSchema,
  assistantSyncDetectorActionSchema,
  assistantSyncGlossaryTermActionSchema,
  assistantSyncMetricActionSchema,
  assistantAttachResultActionSchema,
]);

export type AssistantUiAction = z.infer<typeof assistantUiActionSchema>;

export const assistantToolCallSummarySchema = z.object({
  name: z.string().min(1),
  status: z.enum(["success", "error"]),
  detail: z.string().min(1),
});

export type AssistantToolCallSummary = z.infer<
  typeof assistantToolCallSummarySchema
>;

export const assistantChatRequestSchema = z.object({
  messages: z.array(assistantChatMessageSchema).min(1),
  context: assistantPageContextSchema,
  pendingConfirmation: assistantPendingConfirmationSchema.nullable().optional(),
});

export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

export const assistantChatResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z.array(assistantUiActionSchema),
  pendingConfirmation: assistantPendingConfirmationSchema.nullable(),
  toolCalls: z.array(assistantToolCallSummarySchema),
});

export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;

export const assistantContextRegistrySchema = z.record(
  assistantContextKeySchema,
  z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    supportedOperations: z.array(assistantOperationSchema),
  }),
);

export const assistantContexts = assistantContextRegistrySchema.parse({
  "source.create": {
    title: "Source Setup Assistant",
    summary:
      "Guide source creation, patch source fields, and confirm source creation or connection testing.",
    supportedOperations: [
      "create_source",
      "update_source",
      "test_source_connection",
    ],
  },
  "source.edit": {
    title: "Source Edit Assistant",
    summary:
      "Refine an existing source, patch source fields, and confirm updates or connection tests.",
    supportedOperations: ["update_source", "test_source_connection"],
  },
  "detector.create": {
    title: "Detector Studio Assistant",
    summary:
      "Brainstorm detector structure, patch detector fields, and confirm detector creation or training.",
    supportedOperations: ["create_custom_detector", "train_custom_detector"],
  },
  "semantic.glossary": {
    title: "Glossary Assistant",
    summary:
      "Help users define business glossary terms by describing what they want to track in plain language. Translate business intent into detector type filters, severity filters, and status filters.",
    supportedOperations: ["create_glossary_term"],
  },
  "semantic.metrics": {
    title: "Metrics Assistant",
    summary:
      "Help users create governed metrics by describing what they want to measure in plain language. Choose the right metric type (SIMPLE, RATIO, DERIVED, TREND) and build the definition.",
    supportedOperations: ["create_metric_definition", "certify_metric"],
  },
});

export type AssistantContextRegistry = typeof assistantContexts;
