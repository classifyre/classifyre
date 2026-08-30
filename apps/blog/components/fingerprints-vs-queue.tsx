/**
 * The screen we removed, next to the one that replaced it.
 *
 * Both panels are drawn from the same corpus so the comparison is fair: 412
 * matched pairs, three real patterns, one weak link chaining two clusters. The
 * point is not that one is prettier — it is that the left panel has no
 * completion state and the right one does.
 *
 * Static SVG and CSS only, so it renders in the static export with no client
 * JS and no screenshot to go stale.
 */

const HAIRBALL_NODES = [
  [22, 30], [44, 18], [66, 26], [88, 40], [104, 22], [126, 34],
  [16, 58], [38, 48], [58, 62], [80, 54], [100, 68], [122, 56],
  [28, 84], [50, 76], [72, 90], [94, 80], [116, 88], [136, 68],
  [34, 104], [60, 110], [86, 104], [110, 112], [130, 98], [18, 96],
] as const;

// Deliberately dense and arbitrary — that is what the canvas looked like.
const HAIRBALL_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 7], [7, 8], [8, 9],
  [9, 10], [10, 11], [6, 7], [1, 8], [2, 9], [3, 10], [5, 11],
  [6, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17],
  [8, 13], [9, 15], [11, 17], [12, 18], [18, 19], [19, 20],
  [20, 21], [21, 22], [13, 19], [14, 20], [16, 21], [23, 12],
  [23, 6], [0, 23], [4, 11], [7, 18], [10, 16], [2, 5], [17, 22],
];

const PATTERNS = [
  {
    labels: "email + person",
    rule: "needs judgement",
    left: 208,
    lift: "1.0×",
    tone: "judgement" as const,
    width: 100,
  },
  {
    labels: "boilerplate",
    rule: "rule candidate",
    left: 146,
    lift: "146×",
    tone: "rule" as const,
    width: 70,
  },
  {
    labels: "iban",
    rule: "cutoff candidate",
    left: 41,
    lift: "3.2×",
    tone: "cutoff" as const,
    width: 20,
  },
  {
    labels: "identical content",
    rule: "no judgement needed",
    left: 17,
    lift: "—",
    tone: "merge" as const,
    width: 9,
  },
];

const TONE: Record<string, string> = {
  judgement: "bg-stone-400 dark:bg-stone-500",
  rule: "bg-red-500",
  cutoff: "bg-amber-500",
  merge: "bg-emerald-500",
};

function Panel({
  eyebrow,
  title,
  verdict,
  children,
}: {
  eyebrow: string;
  title: string;
  verdict: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-[6px] border-2 border-border bg-background">
      <div className="border-b-2 border-border px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </span>
        <p className="font-serif text-base font-black uppercase tracking-[0.04em]">
          {title}
        </p>
      </div>
      <div className="flex-1 p-4">{children}</div>
      <p className="border-t-2 border-border px-4 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
        {verdict}
      </p>
    </div>
  );
}

export function FingerprintsVsQueue() {
  return (
    <figure className="my-10 not-prose">
      <div className="flex flex-col gap-4 md:flex-row">
        <Panel
          eyebrow="Before · Fingerprints"
          title="A similarity canvas"
          verdict="412 pairs. No order, no counts, no end. Every session started from scratch."
        >
          <svg
            viewBox="0 0 152 128"
            className="h-[176px] w-full"
            role="img"
            aria-label="A dense, unordered graph of similarity links between assets"
          >
            {HAIRBALL_EDGES.map(([a, b], i) => {
              const from = HAIRBALL_NODES[a];
              const to = HAIRBALL_NODES[b];
              if (!from || !to) return null;
              return (
                <line
                  key={i}
                  x1={from[0]}
                  y1={from[1]}
                  x2={to[0]}
                  y2={to[1]}
                  className="stroke-muted-foreground/35"
                  strokeWidth={0.6}
                />
              );
            })}
            {HAIRBALL_NODES.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={2.6}
                className="fill-foreground/70"
              />
            ))}
          </svg>
        </Panel>

        <Panel
          eyebrow="After · Duplicate review"
          title="A ranked queue"
          verdict="Same 412 pairs. One rule clears 146 of them; 17 need no judgement at all."
        >
          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2 border-b-2 border-border pb-2">
              <span className="font-serif text-3xl font-black tabular-nums leading-none">
                412
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                pairs remaining
              </span>
            </div>
            {PATTERNS.map((p) => (
              <div key={p.labels} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-foreground">
                    {p.labels}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {p.left} left · {p.lift}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-[2px] bg-muted">
                  <div
                    className={`h-full ${TONE[p.tone]}`}
                    style={{ width: `${p.width}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {p.rule}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <figcaption className="mt-3 text-center font-mono text-[11px] text-muted-foreground">
        The same corpus, drawn two ways. Only one of them can be finished.
      </figcaption>
    </figure>
  );
}
