"use client";

import * as React from "react";
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
import { useTranslation } from "@/hooks/use-translation";

export const CASE_SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
] as const;

export type CaseDetailsValues = {
  title: string;
  description: string;
  severity: string;
  assignee: string;
};

export const EMPTY_CASE_DETAILS: CaseDetailsValues = {
  title: "",
  description: "",
  severity: "MEDIUM",
  assignee: "",
};

/**
 * The fields that describe a case, independent of how it was started.
 *
 * Shared by the creation stepper and the edit page so the two cannot drift —
 * before this, a case could only ever be described at the moment it was opened,
 * and there was no edit route at all.
 */
export function CaseDetailsForm({
  values,
  onChange,
  idPrefix = "case",
}: {
  values: CaseDetailsValues;
  onChange: (next: CaseDetailsValues) => void;
  /** Keeps label/input ids unique when two of these share a page. */
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof CaseDetailsValues>(
    key: K,
    value: CaseDetailsValues[K],
  ) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-title`}>
          {t("investigations.newCase.titleLabel")}
        </Label>
        <Input
          id={`${idPrefix}-title`}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("investigations.newCase.titlePlaceholder")}
          maxLength={300}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-description`}>
          {t("investigations.newCase.descriptionLabel")}
        </Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={t("investigations.newCase.descriptionPlaceholder")}
          rows={4}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("investigations.newCase.severityLabel")}</Label>
          <Select
            value={values.severity}
            onValueChange={(v) => set("severity", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CASE_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-assignee`}>
            {t("investigations.newCase.assigneeLabel")}
          </Label>
          <Input
            id={`${idPrefix}-assignee`}
            value={values.assignee}
            onChange={(e) => set("assignee", e.target.value)}
            placeholder={t("investigations.newCase.assigneePlaceholder")}
          />
        </div>
      </div>
    </div>
  );
}
