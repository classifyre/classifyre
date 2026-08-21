"use client";

import * as React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

/**
 * A path field with a native "Browse..." button when there is one to offer.
 *
 * `window.electronAPI.selectFolder` is exposed only by the desktop app's
 * preload script, so in a browser this degrades to a plain text input rather
 * than showing a button that cannot work. Shared by the LOCAL_FOLDER source's
 * `required.path` field and by a CUSTOM source's local folders, so the IPC call
 * has one caller and both behave the same.
 */
export function FolderPathInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  inputProps,
  testId,
}: {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputProps?: Omit<
    React.ComponentProps<typeof Input>,
    "value" | "onChange" | "disabled" | "placeholder"
  >;
  /** Suffixes `input-` and `browse-` test ids, matching the rest of the forms. */
  testId?: string;
}) {
  const { t } = useTranslation();
  const [canBrowse, setCanBrowse] = React.useState(false);
  const [browsing, setBrowsing] = React.useState(false);

  // In an effect rather than during render: the server render has no window,
  // and deciding this while hydrating would mismatch.
  React.useEffect(() => {
    setCanBrowse(
      typeof window !== "undefined" &&
        typeof window.electronAPI?.selectFolder === "function",
    );
  }, []);

  const browse = async () => {
    if (!window.electronAPI?.selectFolder) return;
    setBrowsing(true);
    try {
      const result = await window.electronAPI.selectFolder();
      if (!result.canceled && result.path) onChange(result.path);
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="flex-1"
        data-testid={testId ? `input-${testId}` : undefined}
        {...inputProps}
      />
      {canBrowse && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void browse()}
          disabled={disabled || browsing}
          data-testid={testId ? `browse-${testId}` : undefined}
        >
          <FolderOpen className="mr-1 h-4 w-4" />
          {t("forms.browse")}
        </Button>
      )}
    </div>
  );
}
