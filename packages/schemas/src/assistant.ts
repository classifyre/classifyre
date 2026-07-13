import { z } from "zod";

export const assistantContextKeySchema = z.enum([
  "source.create",
  "source.edit",
  "detector.create",
  "detector.edit",
  "fingerprints.tune",
  "inquiry.create",
  "inquiry.manage",
  "case.create",
  "case.manage",
  "app.global",
]);

export type AssistantContextKey = z.infer<typeof assistantContextKeySchema>;

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
});

export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

/**
 * A tool call the assistant proposed and the user must confirm before it runs.
 * `tool` is the MCP tool name and `input` the exact arguments that will be
 * passed to it on confirmation — the client echoes this object back verbatim.
 */
export const assistantPendingConfirmationSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
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

const assistantNavigateActionSchema = z.object({
  type: z.literal("navigate"),
  /** App-internal route, e.g. "/detectors/new". Absolute URLs are rejected. */
  route: z
    .string()
    .min(1)
    .regex(/^\/(?!\/)/, "route must be an app-internal path"),
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

const assistantAttachResultActionSchema = z.object({
  type: z.literal("attach_result"),
  kind: z.enum(["source_test", "detector_train", "operation"]),
  title: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const assistantUiActionSchema = z.discriminatedUnion("type", [
  assistantToastActionSchema,
  assistantPatchFieldsActionSchema,
  assistantNavigateActionSchema,
  assistantSyncSourceActionSchema,
  assistantSyncDetectorActionSchema,
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
  /**
   * Set by the client when the user pressed the explicit Confirm/Cancel
   * buttons, so intent never depends on free-text parsing. Free-text
   * "confirm"/"cancel" still works as a fallback.
   */
  confirmationDecision: z.enum(["confirm", "cancel"]).nullable().optional(),
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
  }),
);

export const assistantContexts = assistantContextRegistrySchema.parse({
  "source.create": {
    title: "Source Setup Assistant",
    summary:
      "Guide source creation, patch source fields, validate the config, and confirm source creation or connection testing.",
  },
  "source.edit": {
    title: "Source Edit Assistant",
    summary:
      "Refine an existing source, patch source fields, and confirm updates or connection tests.",
  },
  "detector.create": {
    title: "Detector Studio Assistant",
    summary:
      "Brainstorm detector structure, patch detector fields, and confirm detector creation, testing, or training.",
  },
  "detector.edit": {
    title: "Detector Tuning Assistant",
    summary:
      "Review, test, retrain, and refine an existing custom detector.",
  },
  "fingerprints.tune": {
    title: "Fingerprints Tuning Assistant",
    summary:
      "Explore correlation results and retune label weights, thresholds, and exclusions.",
  },
  "inquiry.create": {
    title: "Inquiry Builder Assistant",
    summary:
      "Build and preview inquiry matchers over sources, detectors, and findings before saving.",
  },
  "inquiry.manage": {
    title: "Inquiry Assistant",
    summary:
      "Review matches, search related assets and findings, and refine or rematch this inquiry.",
  },
  "case.create": {
    title: "Case Builder Assistant",
    summary:
      "Create a case and seed it with evidence from inquiries or findings.",
  },
  "case.manage": {
    title: "Case Assistant",
    summary:
      "Manage this case: hypotheses, threads, evidence, and summaries of the investigation so far.",
  },
  "app.global": {
    title: "Classifyre Assistant",
    summary:
      "Ask about anything in the workspace — sources, detectors, findings, inquiries, and cases — or jump to the right page.",
  },
});

export type AssistantContextRegistry = typeof assistantContexts;
