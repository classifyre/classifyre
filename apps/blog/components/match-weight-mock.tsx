/**
 * The score breakdown, as the pair screen draws it.
 *
 * The load-bearing detail is the negative half of each bar: weight that was
 * available on one side and found no partner on the other. Showing evidence
 * against in the same units as evidence for is what makes the total defensible
 * — the bars add up to the number above them, with nothing hidden in a blend.
 *
 * Numbers here are a real-shaped example, not a screenshot, so they cannot go
 * stale against a UI change.
 */

const ROWS = [
  { label: "iban", weight: 6, forPart: 0.42, against: 0, shared: "DE89 3704 …" },
  { label: "email", weight: 5, forPart: 0.24, against: 0, shared: "a.mendes@…" },
  { label: "person", weight: 2, forPart: 0.05, against: 0.09, shared: "ana mendes" },
  { label: "address", weight: 3, forPart: 0, against: 0.14, shared: "nothing shared" },
  { label: "phone", weight: 4, forPart: 0, against: 0.06, shared: "nothing shared" },
];

const SCALE = 0.45; // widest bar in the set, for proportional widths

export function MatchWeightMock() {
  const total = ROWS.reduce((sum, r) => sum + r.forPart, 0);

  return (
    <figure className="my-10 not-prose rounded-[6px] border-2 border-border bg-background">
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-border px-4 py-3">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Match weight
          </span>
          <p
            className="font-serif text-3xl font-black leading-none tabular-nums"
          >
            {total.toFixed(2)}
          </p>
        </div>
        <span className="text-right font-mono text-[10px] leading-4 text-muted-foreground">
          Perfect match = 1.00
          <br />
          the bars below sum to {total.toFixed(2)}
        </span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {ROWS.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
              <span className="text-foreground">
                {r.label}{" "}
                <span className="text-muted-foreground">weight {r.weight}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {r.forPart > 0 ? `+${r.forPart.toFixed(2)}` : "0.00"}
                {r.against > 0 ? ` · −${r.against.toFixed(2)}` : ""}
              </span>
            </div>
            {/* Centre line: everything right of it helped, everything left
                of it is weight that was available and went unclaimed. */}
            <div className="flex items-center gap-px">
              <div className="flex h-3 flex-1 justify-end">
                {r.against > 0 ? (
                  <div
                    className="h-full bg-red-500/60"
                    style={{ width: `${(r.against / SCALE) * 100}%` }}
                  />
                ) : null}
              </div>
              <div className="h-4 w-px bg-foreground/40" />
              <div className="flex h-3 flex-1">
                {r.forPart > 0 ? (
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${(r.forPart / SCALE) * 100}%` }}
                  />
                ) : null}
              </div>
            </div>
            <p className="text-center font-mono text-[9px] text-muted-foreground">
              {r.shared}
            </p>
          </div>
        ))}
      </div>

      <p className="border-t-2 border-border px-4 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
        Left of the line is evidence <em>against</em>: an address and a phone
        number on one asset that the other does not have. It is inside the sum,
        not omitted from it.
      </p>
    </figure>
  );
}
