"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import {
  api,
  getNamespacedApiBaseUrl,
  type ContractImportResultDto,
} from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * The asset as an Open Data Contract Standard contract (GOV §5.5): download
 * it as YAML or JSON, or apply one — description, team, columns and quality
 * rules, matched by name — and see what was applied and what was skipped.
 */
export function ContractCard({
  assetId,
  canGovern,
  onImported,
}: {
  assetId: string;
  canGovern: boolean;
  /** Everything the contract can change is re-read. */
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ContractImportResultDto | null>(null);

  const href = (format: "yaml" | "json") =>
    `${getNamespacedApiBaseUrl().replace(/\/$/, "")}/assets/${assetId}/contract?format=${format}`;

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const result = await api.governance.governanceControllerImportContract({
        id: assetId,
        importContractDto: { contract: await file.text() },
      });
      setReport(result);
      toast.success(t("governance.contract.imported"));
      onImported();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.contract.failed")),
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card data-testid="contract-card">
      <CardHeader>
        <CardTitle>{t("governance.contract.title")}</CardTitle>
        <CardDescription>
          {t("governance.contract.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={href("yaml")} data-testid="contract-yaml">
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("governance.contract.yaml")}
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={href("json")}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("governance.contract.json")}
            </a>
          </Button>
          {canGovern && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
                data-testid="contract-import"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                {t("governance.contract.import")}
              </Button>
              <input
                ref={input}
                type="file"
                accept=".yaml,.yml,.json,application/yaml,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </>
          )}
        </div>
        {report && (
          <div className="space-y-1 text-sm" data-testid="contract-report">
            <p>
              {t("governance.contract.applied", {
                members: report.applied.members,
                columns: report.applied.columns,
                rules: report.applied.rules,
              })}
            </p>
            {report.skipped.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {report.skipped.map((item, index) => (
                  <li key={index}>
                    <span className="font-mono">{item.path}</span>:{" "}
                    {item.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
