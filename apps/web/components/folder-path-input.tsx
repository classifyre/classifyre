"use client";

import * as React from "react";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A path field for a folder that lives where the *scan* runs, not where the
 * browser does.
 *
 * There is deliberately no "Browse…" button. The path is resolved by the
 * process that performs the scan — a directory bind-mounted into the
 * all-in-one container, or one the chart mounts into CLI job pods via
 * `api.localFolders` — so a picker rooted in the operator's own filesystem
 * would offer paths that do not exist over there. Shared by the Mounted Folder
 * source's `required.path` field and by a CUSTOM source's local folders.
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
  /** Suffixes `input-`, matching the rest of the forms. */
  testId?: string;
}) {
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
    </div>
  );
}
