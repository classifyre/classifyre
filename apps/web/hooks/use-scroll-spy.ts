"use client";

import * as React from "react";

/**
 * Track which stacked section is in view, and scroll to one on demand.
 *
 * The stepper in this app is a scroll-spy, not a state machine: every section
 * renders at once and the nav follows the reader rather than gating them. That
 * wiring — a set of refs, an IntersectionObserver with a bottom-heavy
 * rootMargin, and a smooth scrollIntoView — was copy-pasted into seven files
 * before this hook existed, which is why the margin is the same everywhere by
 * luck rather than by design.
 *
 * `deps` re-observes when the sections themselves change, e.g. a step that
 * only appears once a config loads.
 */
export function useScrollSpy<Id extends string>(
  stepIds: readonly Id[],
  deps: React.DependencyList = [],
) {
  const [activeStep, setActiveStep] = React.useState<Id>(stepIds[0]!);
  const refs = React.useRef(
    {} as Record<Id, React.RefObject<HTMLElement | null>>,
  );
  for (const id of stepIds) {
    refs.current[id] ??= React.createRef<HTMLElement>();
  }

  React.useEffect(() => {
    const els = stepIds
      .map((id) => ({ id, el: refs.current[id]?.current }))
      .filter((x): x is { id: Id; el: HTMLElement } => !!x.el);
    const map = new Map<Element, Id>(els.map(({ id, el }) => [el, id]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const id = map.get(entry.target);
            if (id) setActiveStep(id);
          }
      },
      // Bottom-heavy: a section counts as current once its top reaches the
      // upper third, so the nav moves with the reader rather than a step early.
      { rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    els.forEach(({ el }) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollTo = React.useCallback((id: Id) => {
    refs.current[id]?.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  return { activeStep, setActiveStep, sectionRefs: refs.current, scrollTo };
}
