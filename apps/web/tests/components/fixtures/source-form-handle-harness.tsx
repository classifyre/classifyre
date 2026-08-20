"use client";

import * as React from "react";
import {
  SourceForm,
  type SourceFormHandle,
  type SourceType,
} from "@/components/source-form";

/**
 * Exposes `SourceFormHandle.getValues()` to a component test.
 *
 * Both source pages render the form with `showActions={false}` and read the
 * imperative handle rather than going through `onSubmit`, so the handle is the
 * path that actually ships. A ref cannot cross the component-test boundary, so
 * the harness calls it in the browser and writes the result into the DOM.
 */
export function SourceFormHandleHarness({
  sourceType,
  sourceId,
  defaultValues,
}: {
  sourceType: SourceType;
  sourceId?: string;
  defaultValues?: Record<string, unknown>;
}) {
  const ref = React.useRef<SourceFormHandle | null>(null);
  const [captured, setCaptured] = React.useState<string>("");

  return (
    <div>
      <button
        type="button"
        data-testid="capture-values"
        onClick={() =>
          setCaptured(JSON.stringify(ref.current?.getValues() ?? null))
        }
      >
        capture
      </button>
      <pre data-testid="captured-values">{captured}</pre>
      <SourceForm
        ref={ref}
        sourceType={sourceType}
        sourceId={sourceId}
        mode="edit"
        defaultValues={defaultValues}
        onSubmit={() => undefined}
        showCancel={false}
        showActions={false}
      />
    </div>
  );
}
