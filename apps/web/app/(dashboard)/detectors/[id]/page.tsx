"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Trash2 } from "lucide-react";
import {
  api,
  type CustomDetectorResponseDto,
  type CustomDetectorTrainingRunDto,
  type UpdateCustomDetectorDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { toast } from "sonner";
import {
  CustomDetectorEditor,
  type CustomDetectorEditorSubmit,
} from "@/components/custom-detector-editor";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";
import { CustomDetectorTrainingHistoryTable } from "@/components/custom-detector-training-history-table";
import { CustomDetectorExtractionCoverage } from "@/components/custom-detector-extraction-coverage";
import { formatDate } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

// The generated DTO is out-of-sync with the server — pipeline detectors carry
// pipelineSchema rather than config/method. Extend locally until codegen is refreshed.
type DetectorWithPipeline = CustomDetectorResponseDto & {
  pipelineSchema?: Record<string, unknown>;
};

export default function CustomDetectorDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslation();
  const detectorId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [detector, setDetector] = useState<DetectorWithPipeline | null>(
    null,
  );
  const [history, setHistory] = useState<CustomDetectorTrainingRunDto[]>([]);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      const detectorPayload = await api.getCustomDetector(detectorId) as DetectorWithPipeline;
      setDetector(detectorPayload);

      // Pipeline detectors always get training history; legacy detectors skip it for RULESET.
      const isPipeline = Boolean(detectorPayload.pipelineSchema && Object.keys(detectorPayload.pipelineSchema).length > 0);
      if (isPipeline || detectorPayload.method !== "RULESET") {
        const historyPayload = await api.listCustomDetectorTrainingHistory(
          detectorId,
          50,
        );
        setHistory(Array.isArray(historyPayload) ? historyPayload : []);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToLoad"),
      );
      router.push("/detectors");
    } finally {
      setIsLoading(false);
    }
  }, [detectorId, router]);

  useEffect(() => {
    if (detectorId) {
      void load();
    }
  }, [detectorId, load]);

  const handleSave = async (payload: CustomDetectorEditorSubmit) => {
    const updateRequest: UpdateCustomDetectorDto = {
      name: payload.name,
      key: payload.key,
      description: payload.description,
      method: payload.method,
      isActive: payload.isActive,
      config: payload.config,
    };

    try {
      setIsSaving(true);
      await api.updateCustomDetector(detectorId, updateRequest);
      toast.success(t("detectors.saved"));
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToSave"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTrain = async () => {
    try {
      setIsTraining(true);
      await api.trainCustomDetector(detectorId, {});
      toast.success(t("detectors.trainingStarted"));
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToTrain"),
      );
    } finally {
      setIsTraining(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await api.deleteCustomDetector(detectorId);
      toast.success(t("detectors.deleted"));
      router.push("/detectors");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToDelete"),
      );
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  if (isLoading || !detector) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("detectors.loadingLabel")}
      </div>
    );
  }

  const sourcesUsing = detector.sourcesUsing ?? [];
  // Pipeline detectors (GLiNER2 / REGEX / LLM) carry pipelineSchema instead of config.
  const isPipelineDetector = Boolean(detector.pipelineSchema && Object.keys(detector.pipelineSchema).length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/detectors")}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detectors.backToCustom")}
        </Button>
        <div className="flex items-center gap-2">
          {(isPipelineDetector || detector.method !== "RULESET") && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTrain}
              disabled={isTraining}
              data-testid="btn-train-detector"
            >
              <Play className="h-4 w-4" />
              {isTraining ? t("common.training") : t("detectors.trainNow")}
            </Button>
          )}
          <Button
            size="sm"
            className="rounded-[4px] border-2 border-black bg-[#ff2b2b] text-white shadow-[3px_3px_0_#000] hover:bg-[#e62626]"
            onClick={() => setShowDeleteDialog(true)}
            data-testid="btn-delete-detector"
          >
            <Trash2 className="h-4 w-4" />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{detector.name}</CardTitle>
              <CardDescription className="font-mono text-xs">
                {detector.key}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent
          className={`grid gap-3 ${(isPipelineDetector || detector.method !== "RULESET") ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
          <div className="rounded-[4px] border border-black/20 p-3">
            <p className="text-xs text-muted-foreground mb-1">
              {t("detectors.sourcesUsing")}
            </p>
            {sourcesUsing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("common.none")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {sourcesUsing.map((source) => (
                  <li key={source.id}>
                    <a
                      href={`/sources/${source.id}`}
                      className="text-sm font-medium underline underline-offset-2 hover:text-foreground/70"
                    >
                      {source.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-[4px] border border-black/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("detectors.sourcesWithFindings")}
            </p>
            <p className="text-lg font-semibold">
              {detector.sourcesWithFindingsCount}
            </p>
          </div>
          {(isPipelineDetector || detector.method !== "RULESET") && (
            <div className="rounded-[4px] border border-black/20 p-3">
              <p className="text-xs text-muted-foreground">
                {t("detectors.lastTrained")}
              </p>
              <p className="text-sm font-medium">
                {detector.lastTrainedAt
                  ? formatDate(detector.lastTrainedAt)
                  : t("detectors.never")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {isPipelineDetector ? (
        <PipelineDetectorEditor
          mode="edit"
          detectorId={detectorId}
          submitLabel={t("common.save")}
          isSubmitting={isSaving}
          initialPipelineSchema={detector.pipelineSchema}
          initialName={detector.name}
          initialKey={detector.key}
          initialDescription={detector.description ?? ""}
          onSubmit={async (payload) => {
            try {
              setIsSaving(true);
              await api.updateCustomDetector(detectorId, {
                name: payload.name,
                key: payload.key,
                description: payload.description,
                isActive: payload.isActive,
                pipelineSchema: payload.pipelineSchema,
              } as any);
              toast.success(t("detectors.saved"));
              await load();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t("detectors.failedToSave"));
            } finally {
              setIsSaving(false);
            }
          }}
        />
      ) : (
        <CustomDetectorEditor
          mode="edit"
          initialValue={{
            id: detector.id,
            name: detector.name,
            key: detector.key,
            description: detector.description ?? "",
            method: detector.method,
            isActive: detector.isActive,
            config: detector.config,
          }}
          submitLabel={t("common.save")}
          isSubmitting={isSaving}
          onSubmit={handleSave}
        />
      )}

      {Boolean(detector.config?.extractor) && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
            {t("detectors.extractionTab")}
          </h2>
          <CustomDetectorExtractionCoverage detectorId={detectorId} />
        </section>
      )}

      {(isPipelineDetector || detector.method !== "RULESET") && (
        <section data-testid="training-history-section" className="space-y-4">
          <div>
            <h2 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
              {t("detectors.trainingHistoryTab")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("detectors.findingsCount", { count: detector.findingsCount })}
            </p>
          </div>
          <CustomDetectorTrainingHistoryTable history={history} />
        </section>
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("detectors.deleteTitle", { name: detector.name })}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <p>{t("detectors.deleteConfirm")}</p>
                {sourcesUsing.length > 0 && (
                  <div className="rounded-[4px] border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive mb-2">
                      This detector is used in {sourcesUsing.length} source
                      {sourcesUsing.length !== 1 ? "s" : ""}:
                    </p>
                    <ul className="space-y-1">
                      {sourcesUsing.map((source) => (
                        <li key={source.id}>
                          <a
                            href={`/sources/${source.id}`}
                            className="text-sm underline underline-offset-2 text-destructive hover:text-destructive/70"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">
                      {t("detectors.deleteImpact")}
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="btn-delete-detector-confirm"
            >
              {isDeleting
                ? t("detectors.deleting")
                : t("detectors.deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
