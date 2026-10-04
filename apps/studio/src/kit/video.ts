import type { ComponentType } from "react";

export interface VideoDefinition {
  /** Composition id: letters, digits and dashes. Also the output file name. */
  id: string;
  component: ComponentType;
  durationInFrames: number;
  fps?: number;
  width?: number;
  height?: number;
}

export const VIDEO_DEFAULTS = { fps: 30, width: 1920, height: 1080 } as const;

/** What a `videos/<name>/video.tsx` default-exports to appear in the studio. */
export function defineVideo(definition: VideoDefinition): VideoDefinition {
  return definition;
}
