import all_detectors_examples from "@workspace/schemas/all_detectors_examples";

export interface DetectorExample {
  name: string;
  description: string;
  config: Record<string, unknown>;
}

export function getDetectorExamples(detectorType: string): DetectorExample[] {
  const examplesByType = all_detectors_examples as Record<
    string,
    DetectorExample[]
  >;
  return examplesByType[detectorType] || [];
}
