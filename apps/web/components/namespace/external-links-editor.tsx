"use client";

import * as React from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { type NamespaceExternalLinkInput } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useTranslation } from "@/hooks/use-translation";

/** A row being edited. `key` is local-only, so a blank new row still has identity. */
export interface EditableLink extends NamespaceExternalLinkInput {
  key: string;
}

export function newLinkRow(): EditableLink {
  return {
    key:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `link-${Date.now()}-${Math.random()}`,
    title: "",
    url: "",
  };
}

/**
 * A row is only saved once BOTH fields are filled — the API rejects a half-link
 * and the operator should not lose the rest of the form to a row they were
 * still typing.
 */
export function isCompleteLink(link: EditableLink): boolean {
  return link.title.trim().length > 0 && link.url.trim().length > 0;
}

/** True when a row has one field filled and the other empty. */
export function isPartialLink(link: EditableLink): boolean {
  const hasTitle = link.title.trim().length > 0;
  const hasUrl = link.url.trim().length > 0;
  return hasTitle !== hasUrl;
}

const MAX_LINKS = 20;

/**
 * Editor for a workspace's external links (name + URL, both mandatory), shown
 * on the workspace card and opened in a new tab from there.
 */
export function ExternalLinksEditor({
  links,
  onChange,
  disabled = false,
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const update = (key: string, patch: Partial<EditableLink>) =>
    onChange(
      links.map((link) => (link.key === key ? { ...link, ...patch } : link)),
    );

  return (
    <div className="space-y-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("workspaces.linksEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {links.map((link, index) => {
            const partial = isPartialLink(link);
            return (
              <li
                key={link.key}
                className="flex flex-col gap-2 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Label
                    htmlFor={`link-title-${link.key}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t("workspaces.linkName")}
                  </Label>
                  <Input
                    id={`link-title-${link.key}`}
                    value={link.title}
                    onChange={(event) =>
                      update(link.key, { title: event.target.value })
                    }
                    placeholder={t("workspaces.linkNamePlaceholder")}
                    maxLength={80}
                    disabled={disabled}
                    aria-invalid={partial && !link.title.trim()}
                  />
                </div>
                <div className="min-w-0 flex-[1.6] space-y-1">
                  <Label
                    htmlFor={`link-url-${link.key}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t("workspaces.linkUrl")}
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      id={`link-url-${link.key}`}
                      value={link.url}
                      onChange={(event) =>
                        update(link.key, { url: event.target.value })
                      }
                      placeholder="https://example.com"
                      type="url"
                      inputMode="url"
                      spellCheck={false}
                      disabled={disabled}
                      aria-invalid={partial && !link.url.trim()}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={disabled}
                      onClick={() =>
                        onChange(links.filter((item) => item.key !== link.key))
                      }
                      aria-label={t("workspaces.linkRemoveAria", {
                        name: link.title || String(index + 1),
                      })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {links.some(isPartialLink) && (
        <p className="text-xs text-destructive">
          {t("workspaces.linkIncomplete")}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || links.length >= MAX_LINKS}
        onClick={() => onChange([...links, newLinkRow()])}
      >
        <Plus className="size-4" />
        {t("workspaces.linkAdd")}
      </Button>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ExternalLink className="size-3 shrink-0" />
        {t("workspaces.linksHint")}
      </p>
    </div>
  );
}
