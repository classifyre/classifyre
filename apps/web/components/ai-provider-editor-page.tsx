"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type AiProviderConfigResponseDto } from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@workspace/ui/components";
import { ArrowLeft, BrainCircuit } from "lucide-react";
import { toast } from "sonner";
import {
  AiProviderForm,
  type ProviderAssignments,
} from "@/components/ai-provider-form";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { useRouteId } from "@/lib/use-route-id";

export function AiProviderEditorPage({ mode }: { mode: "new" | "edit" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const routeId = useRouteId();
  const { settings, updateSettings } = useInstanceSettings();
  const [config, setConfig] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [loading, setLoading] = React.useState(mode === "edit");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (mode !== "edit" || !routeId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.aiProviderConfigs
      .aiProviderConfigControllerGet({ id: routeId })
      .then((provider) => {
        if (!cancelled) setConfig(provider);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("aiProvider.failedToLoad"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, routeId, t]);

  const initialAssignments = React.useMemo<ProviderAssignments>(
    () => ({
      assistant: config !== null && settings.aiProviderConfigId === config.id,
      harness:
        config !== null && settings.harnessAiProviderConfigId === config.id,
    }),
    [config, settings.aiProviderConfigId, settings.harnessAiProviderConfigId],
  );

  const returnHref = nsPath("/harness?tab=config");

  const handleSaved = React.useCallback(
    async (
      saved: AiProviderConfigResponseDto,
      close: boolean,
      assignments: ProviderAssignments,
    ) => {
      if (!close) return;
      const assignmentUpdate: Parameters<typeof updateSettings>[0] = {
        ...(assignments.assistant
          ? { aiProviderConfigId: saved.id }
          : settings.aiProviderConfigId === saved.id
            ? { aiProviderConfigId: null }
            : {}),
        ...(assignments.harness
          ? { harnessAiProviderConfigId: saved.id }
          : settings.harnessAiProviderConfigId === saved.id
            ? { harnessAiProviderConfigId: null }
            : {}),
      };
      if (Object.keys(assignmentUpdate).length > 0) {
        await updateSettings(assignmentUpdate);
      }
      toast.success(
        mode === "new" ? t("aiProvider.created") : t("aiProvider.updated"),
      );
      router.push(returnHref);
    },
    [mode, returnHref, router, settings, t, updateSettings],
  );

  const title =
    mode === "new" ? t("aiProvider.newProvider") : t("aiProvider.editProvider");

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 py-2 sm:py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-3" asChild>
            <Link href={returnHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("aiProvider.backToProviders")}
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="rounded-[4px] border-2 border-border bg-muted/30 p-2.5">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t("aiProvider.editorDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <Card className="rounded-[6px] border-2">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" asChild>
              <Link href={returnHref}>{t("aiProvider.backToProviders")}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <AiProviderForm
          config={config}
          initialAssignments={initialAssignments}
          onSaved={handleSaved}
          onCancel={() => router.push(returnHref)}
        />
      )}
    </div>
  );
}
