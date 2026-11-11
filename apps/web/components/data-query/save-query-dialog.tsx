"use client";

import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useTranslation } from "@/hooks/use-translation";

/** Name the SQL on screen, to keep it under Scripts. */
export function SaveQueryDialog({
  open,
  defaultName,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  defaultName: string;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(defaultName);

  React.useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="save-query-dialog">
        <DialogHeader>
          <DialogTitle>{t("dataQuery.explorer.saveTitle")}</DialogTitle>
          <DialogDescription>{t("dataQuery.explorer.saveHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="save-query-name">{t("dataQuery.explorer.saveName")}</Label>
          <Input
            id="save-query-name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() && !busy) onSave(name.trim());
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("dataQuery.explorer.discard")}
          </Button>
          <Button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim() || busy}>
            {t("dataQuery.explorer.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
