import * as React from "react";
import type { SimpleIcon } from "simple-icons";

export type SimpleIconComponent = React.ComponentType<{ className?: string }>;

/**
 * Render a simple-icons glyph as a component.
 *
 * simple-icons ships path data, not components, so every consumer would
 * otherwise hand-roll the same `<svg viewBox="0 0 24 24">` wrapper — and get
 * the accessible name wrong in a different way each time.
 */
export function simpleIconComponent(icon: SimpleIcon): SimpleIconComponent {
  return function SimpleIconGlyph({ className }) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="currentColor"
        role="img"
        aria-label={icon.title}
      >
        <path d={icon.path} />
      </svg>
    );
  };
}
