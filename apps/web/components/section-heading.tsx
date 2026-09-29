import type { LucideIcon } from "lucide-react";

/**
 * A section's name, its count as a chip, and a rule to the edge: where one
 * list on a page ends and the next begins ("Recently opened", then the rest).
 */
export function SectionHeading({
  id,
  title,
  icon: Icon,
  count,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2
        id={id}
        className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.16em] uppercase"
      >
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {title}
        {count !== undefined && (
          <span className="rounded-[3px] bg-foreground px-1.5 py-px text-[10px] text-background tabular-nums">
            {count.toLocaleString()}
          </span>
        )}
      </h2>
      <span aria-hidden className="h-0.5 flex-1 bg-border" />
    </div>
  );
}
