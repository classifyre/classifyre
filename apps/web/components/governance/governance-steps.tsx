"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  HorizontalStepperNav,
  VerticalStepperNav,
  type StepperNavItem,
} from "@/components/stepper-nav";

export interface GovernanceStep {
  id: string;
  title: string;
  description?: string;
  /** Done by its own measure (the checklist), not by scroll position. */
  complete?: boolean;
  content: ReactNode;
}

/**
 * The governance view of an asset or a source (GOV §5.7): one centred column
 * of sections, with the same stepper as the source editor beside it. A step
 * shows ✓ when its checklist item is done, so the stepper doubles as the
 * progress of governing this thing; clicking one scrolls to it.
 */
export function GovernanceSteps({
  steps,
  label,
  banner,
  jumpTo,
}: {
  steps: GovernanceStep[];
  label: string;
  /** Shown above the steps, e.g. "nobody owns this yet". */
  banner?: ReactNode;
  /** A step id to scroll to (set from elsewhere, e.g. the checklist). */
  jumpTo?: { id: string; at: number } | null;
}) {
  const refs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(steps[0]?.id ?? "");
  const ids = steps.map((step) => step.id).join("|");

  useEffect(() => {
    const entries = [...refs.current.entries()];
    const idOf = new Map<Element, string>(entries.map(([id, el]) => [el, id]));
    const observer = new IntersectionObserver(
      (seen) => {
        for (const entry of seen) {
          if (entry.isIntersecting) {
            const id = idOf.get(entry.target);
            if (id) setActive(id);
          }
        }
      },
      { rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );
    entries.forEach(([, el]) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);

  const scrollTo = (id: string) => {
    setActive(id);
    refs.current
      .get(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (jumpTo) scrollTo(jumpTo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.at]);

  const nav: StepperNavItem[] = steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    complete: step.complete,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl" data-testid="governance-steps">
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          steps={nav}
          activeStepId={active}
          onNavigate={scrollTo}
          label={label}
        />
      </div>
      {banner}
      <div className="flex gap-8 lg:gap-12">
        <div className="min-w-0 flex-1 space-y-10 pb-24">
          {steps.map((step) => (
            <section
              key={step.id}
              id={`governance-${step.id}`}
              ref={(el) => {
                if (el) refs.current.set(step.id, el);
                else refs.current.delete(step.id);
              }}
              className="scroll-mt-20 space-y-3"
              data-testid={`governance-step-${step.id}`}
            >
              {step.content}
            </section>
          ))}
        </div>
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            steps={nav}
            activeStepId={active}
            onNavigate={scrollTo}
            label={label}
          />
        </aside>
      </div>
    </div>
  );
}
