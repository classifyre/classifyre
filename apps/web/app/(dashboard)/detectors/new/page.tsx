"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Regex, ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  api,
  type AssistantOperation,
  type AssistantUiAction,
  type CreateCustomDetectorDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import {
  CustomDetectorEditor,
  type CustomDetectorEditorHandle,
  type CustomDetectorEditorSubmit,
} from "@/components/custom-detector-editor";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

type DetectorMethod = "RULESET" | "CLASSIFIER" | "ENTITY";

type MethodConfig = {
  id: DetectorMethod;
  icon: React.ReactNode;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  longKey: TranslationKey;
  accentClass: string;
  badgeClass: string;
};

const METHOD_CONFIGS: MethodConfig[] = [
  {
    id: "RULESET",
    icon: <Regex className="h-7 w-7" strokeWidth={1.5} />,
    titleKey: "detectors.methods.rulesets",
    descKey: "detectors.methods.rulesetsDesc",
    longKey: "detectors.methods.rulesetsLong",
    accentClass: "group-hover:border-[#ff2b2b] group-hover:shadow-[6px_6px_0_#ff2b2b]",
    badgeClass: "bg-[#ff2b2b] text-white",
  },
  {
    id: "CLASSIFIER",
    icon: <Brain className="h-7 w-7" strokeWidth={1.5} />,
    titleKey: "detectors.methods.classifiers",
    descKey: "detectors.methods.classifiersDesc",
    longKey: "detectors.methods.classifiersLong",
    accentClass: "group-hover:border-[#7c3aed] group-hover:shadow-[6px_6px_0_#7c3aed]",
    badgeClass: "bg-[#7c3aed] text-white",
  },
  {
    id: "ENTITY",
    icon: <ScanSearch className="h-7 w-7" strokeWidth={1.5} />,
    titleKey: "detectors.methods.entity",
    descKey: "detectors.methods.entityDesc",
    longKey: "detectors.methods.entityLong",
    accentClass: "group-hover:border-[#0ea5e9] group-hover:shadow-[6px_6px_0_#0ea5e9]",
    badgeClass: "bg-[#0ea5e9] text-white",
  },
];

function MethodCard({
  config,
  selected,
  onSelect,
}: {
  config: MethodConfig;
  selected: boolean;
  onSelect: (id: DetectorMethod) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-testid={`method-card-${config.id}`}
      onClick={() => onSelect(config.id)}
      className={cn(
        "group relative flex flex-col gap-5 rounded-[6px] border-2 border-black bg-background p-6 text-left",
        "shadow-[4px_4px_0_#000] transition-all duration-150",
        "hover:-translate-x-[1px] hover:-translate-y-[1px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
        config.accentClass,
        selected && "border-[#b7ff00] shadow-[6px_6px_0_#000] -translate-x-[1px] -translate-y-[1px]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-[4px] border-2 border-black bg-card">
          {config.icon}
        </div>
        <span
          className={cn(
            "rounded-[4px] border-2 border-black px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] shadow-[2px_2px_0_#000]",
            config.badgeClass,
          )}
        >
          {config.id}
        </span>
      </div>

      <div className="flex-1 space-y-2">
        <h3 className="font-serif text-xl font-black uppercase tracking-[0.06em]">
          {t(config.titleKey)}
        </h3>
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t(config.descKey)}
        </p>
        <p className="text-sm leading-relaxed text-foreground/70">
          {t(config.longKey)}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-[0.12em] text-muted-foreground group-hover:text-foreground transition-colors">
        <span>Select</span>
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
      </div>
    </button>
  );
}

export default function NewCustomDetectorPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const editorRef = useRef<CustomDetectorEditorHandle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<DetectorMethod | null>(null);
  const [createdDetectorId, setCreatedDetectorId] = useState<string | null>(null);

  const handleCreate = async (payload: CustomDetectorEditorSubmit) => {
    const request: CreateCustomDetectorDto = {
      name: payload.name,
      key: payload.key,
      method: payload.method,
      description: payload.description,
      isActive: payload.isActive,
      config: payload.config,
    };

    try {
      setIsSaving(true);
      const created = await api.createCustomDetector(request);
      setCreatedDetectorId(created.id);
      toast.success(t("detectors.created"));
      router.push(`/detectors/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToCreate"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const assistantBridge = useMemo(
    () => ({
      contextKey: "detector.create" as const,
      canOpen: true,
      getContext: async () => {
        const snapshot = editorRef.current?.getAssistantSnapshot();
        const validation = editorRef.current?.validate() ?? {
          isValid: false,
          missingFields: [],
          errors: ["Detector editor is not mounted"],
        };

        return {
          key: "detector.create" as const,
          route: "/detectors/new",
          title: t("detectors.studioAssistant"),
          entityId: createdDetectorId,
          values: {
            name: snapshot?.name ?? "",
            key: snapshot?.key ?? "",
            description: snapshot?.description ?? "",
            method: snapshot?.method ?? selectedMethod ?? "RULESET",
          },
          schema: null,
          validation,
          metadata: {
            name: snapshot?.name ?? "",
            key: snapshot?.key ?? "",
            description: snapshot?.description ?? "",
            method: snapshot?.method ?? selectedMethod ?? "RULESET",
            isActive: snapshot?.isActive ?? true,
            config: snapshot?.config ?? {},
            editorMode: snapshot?.editorMode ?? "builder",
          },
          supportedOperations: createdDetectorId
            ? (["train_custom_detector"] satisfies AssistantOperation[])
            : (["create_custom_detector"] satisfies AssistantOperation[]),
        };
      },
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          editorRef.current?.applyPatches(action.patches);
          return;
        }

        if (action.type === "sync_detector") {
          setCreatedDetectorId(action.detectorId);
          const patches = Object.entries(action.values).map(
            ([path, value]) => ({
              path,
              value,
            }),
          );
          editorRef.current?.applyPatches(patches);
          router.push(`/detectors/${action.detectorId}`);
        }
      },
    }),
    [createdDetectorId, selectedMethod, t],
  );

  useRegisterAssistantBridge(assistantBridge);

  return (
    <div className="container max-w-6xl py-8 space-y-8">
      <div>
        <Button
          variant="outline"
          onClick={() =>
            selectedMethod ? setSelectedMethod(null) : router.push("/detectors")
          }
          className="mb-6 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {selectedMethod ? t("common.back") : t("detectors.backToCatalog")}
        </Button>

        {!selectedMethod ? (
          <>
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                {t("detectors.title")}
              </div>
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
                {t("detectors.selectType")}
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                {t("detectors.selectTypeDesc")}
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {METHOD_CONFIGS.map((config) => (
                <MethodCard
                  key={config.id}
                  config={config}
                  selected={false}
                  onSelect={setSelectedMethod}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                {t("detectors.title")} /
              </div>
              {(() => {
                const cfg = METHOD_CONFIGS.find((c) => c.id === selectedMethod)!;
                return (
                  <span
                    className={cn(
                      "rounded-[4px] border-2 border-black px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] shadow-[2px_2px_0_#000]",
                      cfg.badgeClass,
                    )}
                  >
                    {selectedMethod}
                  </span>
                );
              })()}
            </div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("detectors.addNew")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("detectors.addNewDesc")}
            </p>

            <div className="mt-6">
              <CustomDetectorEditor
                ref={editorRef}
                mode="create"
                initialMethod={selectedMethod}
                submitLabel={t("detectors.create")}
                isSubmitting={isSaving}
                onSubmit={handleCreate}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
