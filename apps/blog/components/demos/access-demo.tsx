"use client";

import { cn } from "@workspace/ui/lib/utils";

import type { Locale } from "@/lib/locale";
import {
  DemoFrame,
  PressButton,
  step,
  useTimeline,
} from "@/components/demos/timeline";

/**
 * Access follows the organisation, played out: groups arrive from the
 * directory, each gets its grant on one table (a district its own rows,
 * finance clear values until a date, the workspace admins every row but
 * still masked), the rules are saved, and the answer to "who sees what" is
 * filled in group by group, then the grant lands in the log.
 *
 * The rules mirror the product (docs.classifyre.com/data-query): access is
 * given to groups, row filtering shows a group only the rows a rule selects
 * for it, and clear reading is a grant of its own.
 */

type Row = {
  group: string;
  people: string;
  grant: string;
  rows: string;
  columns: string;
  clear?: boolean;
};

const L: Record<
  Locale,
  {
    title: string;
    directory: string;
    head: { group: string; grant: string; sees: string };
    rows: readonly Row[];
    save: string;
    saved: string;
    log: string;
  }
> = {
  en: {
    title: "crm.customers · Governance · Access",
    directory: "Groups from Entra ID · synced at sign-in",
    head: { group: "Group", grant: "Grant on this table", sees: "What they see" },
    rows: [
      {
        group: "Amsterdam team",
        people: "12 people",
        grant: "Data reader · rows: city = Amsterdam",
        rows: "1 of 4 rows",
        columns: "masked",
      },
      {
        group: "Brussels team",
        people: "9 people",
        grant: "Data reader · rows: city = Brussels",
        rows: "1 of 4 rows",
        columns: "masked",
      },
      {
        group: "Finance controlling",
        people: "4 people",
        grant: "Data reader, unmasked · until 30 June",
        rows: "4 of 4 rows",
        columns: "clear",
        clear: true,
      },
      {
        group: "Workspace admins",
        people: "2 people",
        grant: "Data reader · rows: all",
        rows: "4 of 4 rows",
        columns: "masked",
      },
    ],
    save: "Save access",
    saved: "Saved",
    log: "09:02 · Alex Morgan (owner) granted Finance controlling clear reading until 30 June",
  },
  de: {
    title: "crm.customers · Governance · Zugriff",
    directory: "Gruppen aus Entra ID · bei der Anmeldung abgeglichen",
    head: { group: "Gruppe", grant: "Freigabe auf diese Tabelle", sees: "Was sie sieht" },
    rows: [
      {
        group: "Bezirk Graz",
        people: "12 Personen",
        grant: "Data reader · Zeilen: city = Graz",
        rows: "1 von 4 Zeilen",
        columns: "maskiert",
      },
      {
        group: "Bezirk Linz",
        people: "9 Personen",
        grant: "Data reader · Zeilen: city = Linz",
        rows: "1 von 4 Zeilen",
        columns: "maskiert",
      },
      {
        group: "Finanzcontrolling",
        people: "4 Personen",
        grant: "Data reader, unmasked · bis 30. Juni",
        rows: "4 von 4 Zeilen",
        columns: "Klartext",
        clear: true,
      },
      {
        group: "Workspace-Admins",
        people: "2 Personen",
        grant: "Data reader · Zeilen: alle",
        rows: "4 von 4 Zeilen",
        columns: "maskiert",
      },
    ],
    save: "Zugriff speichern",
    saved: "Gespeichert",
    log: "09:02 · Maria Huber (Owner) gab Finanzcontrolling Klartext bis 30. Juni frei",
  },
};

const GROUP_AT = 300;
const GROUP_EVERY = 420;
const GRANT_AFTER = 2100;
const GRANT_EVERY = 520;

export function AccessDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  const grantsDone = GROUP_AT + GRANT_AFTER + l.rows.length * GRANT_EVERY;
  const saveAt = grantsDone + 350;
  const seesAt = saveAt + 500;
  const SEES_EVERY = 380;
  const logAt = seesAt + l.rows.length * SEES_EVERY + 300;
  const timeline = useTimeline(logAt + 1200);
  const { t } = timeline;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-accent ring-2 ring-[#0a0a0a]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/60">
          {l.directory}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[460px] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[#0a0a0a]">
              {[l.head.group, l.head.grant, l.head.sees].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="py-1.5 pr-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a]/55"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {l.rows.map((row, index) => {
              const groupIn = step(t, GROUP_AT + index * GROUP_EVERY, 300);
              const grantAt = GROUP_AT + GRANT_AFTER + index * GRANT_EVERY;
              const granted = t >= grantAt;
              const seesIn = step(t, seesAt + index * SEES_EVERY, 300);
              return (
                <tr
                  key={row.group}
                  className="border-b border-[#0a0a0a]/10 align-top"
                  style={{ opacity: groupIn, transform: `translateY(${(1 - groupIn) * 6}px)` }}
                >
                  <td className="py-2 pr-3">
                    <span className="block text-[12.5px] font-semibold">{row.group}</span>
                    <span className="block font-mono text-[10px] text-[#0a0a0a]/50">{row.people}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "inline-block border px-1.5 py-0.5 font-mono text-[10.5px] leading-4 transition-colors duration-300",
                        granted
                          ? row.clear
                            ? "border-[#0a0a0a] bg-accent text-black"
                            : "border-[#0a0a0a] bg-white text-[#0a0a0a]"
                          : "border-dashed border-[#0a0a0a]/30 text-transparent",
                      )}
                    >
                      {row.grant}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-[10.5px] leading-4" style={{ opacity: seesIn }}>
                    <span className="block">{row.rows}</span>
                    <span className={cn("block", row.clear ? "font-semibold" : "text-[#0a0a0a]/55")}>
                      {row.columns}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PressButton t={t} at={saveAt} label={l.save} done={`✓ ${l.saved}`} />
      </div>

      <p
        className="mt-3 border-l-4 border-accent pl-3 font-mono text-[11px] leading-5"
        style={{ opacity: step(t, logAt, 400) }}
      >
        {l.log}
      </p>
    </DemoFrame>
  );
}
