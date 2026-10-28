import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";

const storedSchema = {
  type: "GLINER2",
  model: { name: "fastino/gliner2.5-base-v1", path: null },
  entities: {
    party: { description: "Company that signs the agreement", required: false },
  },
  classification: {
    agreement_type: {
      labels: ["license", "supply"],
      descriptions: {
        license: "Grants rights to use a mark, patent or software",
      },
      multi_label: false,
      read_from: "start",
    },
  },
  severity_map: [{ pattern: "notice_period", severity: "medium" }],
  validation: { confidence_threshold: 0.6, rules: [] },
};

test("label descriptions and severity rules survive a save", async ({
  mount,
}) => {
  const submitted: Array<Record<string, unknown>> = [];

  const component = await mount(
    <PipelineDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialName="Contract facts"
      initialKey="contract_facts"
      initialPipelineSchema={storedSchema}
      onSubmit={(payload) => {
        submitted.push(payload.pipelineSchema);
      }}
    />,
  );

  await expect(
    component.getByTestId("gliner2-label-desc-agreement_type-license"),
  ).toHaveValue("Grants rights to use a mark, patent or software");
  await component
    .getByTestId("gliner2-label-desc-agreement_type-supply")
    .fill("Supply or manufacturing of goods");
  await expect(component.getByTestId("gliner2-severity-pattern")).toHaveValue(
    "notice_period",
  );
  await expect(
    component.getByTestId("gliner2-read-start-agreement_type"),
  ).toBeChecked();

  await component.getByTestId("gliner2-submit-btn").click();

  await expect.poll(() => submitted.length).toBe(1);
  const schema = submitted[0]!;
  expect(schema.severity_map).toEqual([
    { pattern: "notice_period", severity: "medium" },
  ]);
  expect(schema.classification).toEqual({
    agreement_type: {
      labels: ["license", "supply"],
      descriptions: {
        license: "Grants rights to use a mark, patent or software",
        supply: "Supply or manufacturing of goods",
      },
      multi_label: false,
      read_from: "start",
    },
  });
});

test("the model picker offers the GLiNER2.5 checkpoints and a custom id", async ({
  mount,
}) => {
  const component = await mount(
    <PipelineDetectorEditor
      mode="create"
      submitLabel="Create detector"
      onSubmit={() => undefined}
    />,
  );

  await expect(component.getByTestId("gliner2-model-select")).toContainText(
    "GLiNER2.5 base",
  );
  await expect(component.getByTestId("gliner2-model-id")).toHaveCount(0);
});
