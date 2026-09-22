"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { api, type UpdateCaseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import {
  CaseDetailsForm,
  EMPTY_CASE_DETAILS,
  type CaseDetailsValues,
} from "@/components/case-details-form";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Edit a case's own description of itself.
 *
 * Until this existed a case could only be described at the moment it was
 * opened — a typo in the title, or a scope that turned out to be wider than the
 * first hour suggested, was permanent. Deliberately narrow: evidence, threads,
 * driving watches and the timeline all have their own places on the case.
 */
export default function EditCasePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const caseId = useRouteId();

  const [values, setValues] =
    React.useState<CaseDetailsValues>(EMPTY_CASE_DETAILS);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const back = React.useCallback(
    () => router.push(nsPath(`/investigations/${caseId}`)),
    [router, caseId],
  );

  React.useEffect(() => {
    let cancelled = false;
    api.cases
      .casesControllerFindOne({ id: caseId })
      .then((c) => {
        if (cancelled) return;
        setValues({
          title: c.title,
          description: c.description ?? "",
          severity: c.severity,
          assignee: c.assignee ?? "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const save = async () => {
    if (!values.title.trim()) {
      toast.error(t("investigations.newCase.titleRequired"));
      return;
    }
    setSaving(true);
    try {
      const dto: UpdateCaseDto = {
        title: values.title.trim(),
        // Empty clears the field rather than leaving the old text in place.
        description: values.description.trim(),
        severity: values.severity as UpdateCaseDto["severity"],
        assignee: values.assignee.trim(),
      };
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: dto });
      toast.success(t("investigations.editCase.saved"));
      back();
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : t("investigations.editCase.failed"),
      );
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />{" "}
        {t("investigations.editCase.loading")}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        {t("investigations.editCase.notFound")}
      </div>
    );
  }

  return (
    <div className="container max-w-3xl space-y-6 py-8">
      <div>
        <Button
          variant="outline"
          onClick={back}
          className="mb-4 rounded-[4px] border-2 border-border"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("investigations.editCase.back")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("investigations.editCase.title")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          {t("investigations.editCase.description")}
        </p>
      </div>

      <div className="space-y-6 pb-32">
        <AiAssistedCard
          title={t("investigations.newCase.stepDetails")}
          description={t("investigations.newCase.stepDetailsDesc")}
          active
        >
          <CaseDetailsForm
            values={values}
            onChange={setValues}
            idPrefix="edit-case"
          />
        </AiAssistedCard>

        <StickyActionToolbar
          onCancel={back}
          cancelLabel={t("common.cancel")}
          onSaveAndRun={() => void save()}
          saveAndRunLabel={
            saving
              ? t("investigations.editCase.saving")
              : t("investigations.editCase.save")
          }
          runIcon={
            saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )
          }
          isBusy={saving}
          saveAndRunDisabled={!values.title.trim()}
          saveAndRunTestId="btn-save-case"
          className="mt-0"
        />
      </div>
    </div>
  );
}
