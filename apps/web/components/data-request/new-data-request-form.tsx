"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, TableProperties } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { api, type DataRequestOptionsDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { apiErrorMessage } from "@/lib/data-query";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function NewDataRequestForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  const [options, setOptions] = React.useState<DataRequestOptionsDto | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("MEDIUM");
  const [routeGroupId, setRouteGroupId] = React.useState("");
  const [audienceGroupId, setAudienceGroupId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    api.dataRequests
      .dataRequestsControllerOptions()
      .then((res) => {
        if (!active) return;
        setOptions(res);
        if (res.routeGroups[0]) setRouteGroupId(res.routeGroups[0].id);
        if (res.audienceGroups[0]) setAudienceGroupId(res.audienceGroups[0].id);
      })
      .catch(async (err) => {
        if (active) toast.error(await apiErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const canSubmit =
    title.trim().length > 0 &&
    Boolean(routeGroupId) &&
    Boolean(audienceGroupId) &&
    !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await api.dataRequests.dataRequestsControllerCreate({
        createDataRequestDto: {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          routeGroupId,
          audienceGroupId,
        },
      });
      toast.success(t("dataRequest.form.created"));
      router.push(nsPath(`/cases/${created.id}`));
    } catch (err) {
      toast.error(await apiErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4" data-testid="new-data-request-form">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={nsPath("/cases/new")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("common.back")}
          </Link>
        </Button>
      </div>

      <Card className="border-t-2 border-t-sky-500">
        <CardHeader>
          <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
            <TableProperties className="h-5 w-5" />
            <span className="font-mono text-xs uppercase tracking-wider">
              {t("dataRequest.kindLabel")}
            </span>
          </div>
          <CardTitle>{t("dataRequest.form.title")}</CardTitle>
          <CardDescription>{t("dataRequest.form.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="dr-title">
                  {t("dataRequest.form.nameLabel")}
                </Label>
                <Input
                  id="dr-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("dataRequest.form.namePlaceholder")}
                  maxLength={200}
                  required
                  data-testid="dr-title-input"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dr-purpose">
                  {t("dataRequest.form.purposeLabel")}
                </Label>
                <Textarea
                  id="dr-purpose"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("dataRequest.form.purposePlaceholder")}
                  rows={3}
                  maxLength={4000}
                  data-testid="dr-purpose-input"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dr-priority">
                    {t("dataRequest.form.priorityLabel")}
                  </Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as Priority)}
                  >
                    <SelectTrigger id="dr-priority" data-testid="dr-priority-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {t(`cases.severityLabels.${p}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dr-route-group">
                    {t("dataRequest.form.routeGroupLabel")}
                  </Label>
                  <Select
                    value={routeGroupId}
                    onValueChange={setRouteGroupId}
                    disabled={!options?.routeGroups.length}
                  >
                    <SelectTrigger
                      id="dr-route-group"
                      data-testid="dr-route-group-select"
                    >
                      <SelectValue
                        placeholder={t("dataRequest.form.routeGroupPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(options?.routeGroups ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!options?.routeGroups.length && (
                    <p className="text-xs text-destructive">
                      {t("dataRequest.form.noRouteGroups")}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dr-audience-group">
                    {t("dataRequest.form.audienceGroupLabel")}
                  </Label>
                  <Select
                    value={audienceGroupId}
                    onValueChange={setAudienceGroupId}
                    disabled={!options?.audienceGroups.length}
                  >
                    <SelectTrigger
                      id="dr-audience-group"
                      data-testid="dr-audience-group-select"
                    >
                      <SelectValue
                        placeholder={t(
                          "dataRequest.form.audienceGroupPlaceholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(options?.audienceGroups ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!options?.audienceGroups.length && (
                    <p className="text-xs text-destructive">
                      {t("dataRequest.form.noAudienceGroups")}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" type="button" asChild>
                  <Link href={nsPath("/cases")}>{t("common.cancel")}</Link>
                </Button>
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  data-testid="dr-create-submit"
                >
                  {submitting && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  {t("dataRequest.form.submit")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
