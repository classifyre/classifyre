"use client";

import * as React from "react";
import {
  PreviewAssetsDialog,
  type PreviewAsset,
} from "@/components/notebook/preview-assets-dialog";

/** Opens the dialog on mount so a component test can drive it and read it back. */
export function PreviewAssetsDialogHarness({
  assets,
}: {
  assets: PreviewAsset[];
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <div data-testid="preview-harness-marker">harness mounted</div>
      <PreviewAssetsDialog open={open} assets={assets} onOpenChange={setOpen} />
    </div>
  );
}
