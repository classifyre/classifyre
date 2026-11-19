"use client";

import { cn } from "@workspace/ui/lib/utils";

import type { Locale } from "@/lib/locale";
import {
  Caret,
  DemoFrame,
  PressButton,
  step,
  typed,
  typedEnd,
  useTimeline,
} from "@/components/demos/timeline";

/**
 * Governance, played out the way it is done on a table's Governance tab:
 * owner, steward and custodian are assigned from the people-and-groups
 * picker, the columns' access is set (the classification came from the
 * findings), a quality rule is added and run, the owner certifies the
 * table, usage starts to show who reads it and through what, and the whole
 * agreement is exported as an ODCS data contract.
 *
 * Wording follows the app (apps/web i18n `governance.*`): Ownership,
 * Assign, Follow the classification, Shown as, Add rule, Check a column,
 * Invalid values, Run now, Certify, Reads / Exports / Readers.
 */

const L = {
  en: {
    title: "crm.customers · Governance",
    status: { ungoverned: "Ungoverned", draft: "Draft", certified: "Certified" },
    done: (n: number) => `${n} of 5 done`,
    ownership: "Ownership",
    assign: "Assign",
    nobody: "Nobody yet.",
    roles: [
      { role: "Owner", who: "Finance", query: "Fin" },
      { role: "Steward", who: "Data office", query: "Data" },
      { role: "Custodian", who: "IT platform", query: "IT" },
    ],
    group: "Group",
    columns: "Columns",
    columnHeads: ["Column", "Classification", "Access"],
    columnRows: [
      { name: "iban", cls: "Personal data", from: "Follow the classification", to: "Masked · shown as last four" },
      { name: "email", cls: "Personal data", from: "Follow the classification", to: "Masked · shown as hashed" },
      { name: "api_token", cls: "Secret", from: "Follow the classification", to: "Hidden" },
    ],
    reviewed: "Reviewed",
    quality: "Quality",
    addRule: "Add rule",
    rule: "Check a column · iban · Invalid values ≤ 0.5 %",
    runNow: "Run now",
    result: "0.1 % invalid · passed",
    rules: [
      { rule: "email · Missing values = 0", ok: true },
      { rule: "Row count ≥ 4,000", ok: true },
    ],
    certify: "Certify",
    usage: "Usage · last 30 days",
    usageStats: [
      ["Reads", "1,284"],
      ["Exports", "37"],
      ["Readers", "14"],
    ],
    through: "Through: SQL connections, the app, MCP",
    export: "Export data contract",
    yaml: [
      "apiVersion: v3.2.0",
      "kind: DataContract",
      "status: active",
      "team: [Finance, Data office]",
      "schema:",
      "  - name: customers",
      "    properties:",
      "      - name: iban",
      "        classification: personal",
      "        quality:",
      "          - type: library",
      "            metric: invalidValues",
      "            mustBeLessThan: 0.5",
    ],
  },
  de: {
    title: "crm.customers · Governance",
    status: { ungoverned: "Nicht verwaltet", draft: "Entwurf", certified: "Zertifiziert" },
    done: (n: number) => `${n} von 5 erledigt`,
    ownership: "Verantwortung",
    assign: "Zuweisen",
    nobody: "Noch niemand.",
    roles: [
      { role: "Owner", who: "Finanzen", query: "Fin" },
      { role: "Steward", who: "Datenbüro", query: "Daten" },
      { role: "Custodian", who: "IT-Plattform", query: "IT" },
    ],
    group: "Gruppe",
    columns: "Spalten",
    columnHeads: ["Spalte", "Klassifizierung", "Zugriff"],
    columnRows: [
      { name: "iban", cls: "Personenbezogen", from: "Der Klassifizierung folgen", to: "Maskiert · letzte vier" },
      { name: "email", cls: "Personenbezogen", from: "Der Klassifizierung folgen", to: "Maskiert · gehasht" },
      { name: "api_token", cls: "Secret", from: "Der Klassifizierung folgen", to: "Ausgeblendet" },
    ],
    reviewed: "Geprüft",
    quality: "Qualität",
    addRule: "Regel hinzufügen",
    rule: "Spalte prüfen · iban · Ungültige Werte ≤ 0,5 %",
    runNow: "Jetzt ausführen",
    result: "0,1 % ungültig · bestanden",
    rules: [
      { rule: "email · Fehlende Werte = 0", ok: true },
      { rule: "Zeilenzahl ≥ 4.000", ok: true },
    ],
    certify: "Zertifizieren",
    usage: "Nutzung · letzte 30 Tage",
    usageStats: [
      ["Lesezugriffe", "1.284"],
      ["Exporte", "37"],
      ["Lesende", "14"],
    ],
    through: "Über: SQL-Verbindungen, die App, MCP",
    export: "Datenvertrag exportieren",
    yaml: [
      "apiVersion: v3.2.0",
      "kind: DataContract",
      "status: active",
      "team: [Finanzen, Datenbüro]",
      "schema:",
      "  - name: customers",
      "    properties:",
      "      - name: iban",
      "        classification: personal",
      "        quality:",
      "          - type: library",
      "            metric: invalidValues",
      "            mustBeLessThan: 0.5",
    ],
  },
} as const;

/* The script, in milliseconds. */
const ROLE_AT = [300, 1500, 2600];
const ROLE_PICK_MS = 750;
const COLUMN_AT = 3700;
const RULE_AT = 5200;
const RUN_AT = 7000;
const RESULT_AT = 7700;
const CERTIFY_AT = 8500;
const USAGE_AT = 9200;
const EXPORT_AT = 10300;

const SPARK = [3, 5, 4, 7, 6, 9, 8, 12, 10, 14, 11, 15];

export function GovernDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  const yamlAt = EXPORT_AT + 300;
  const yamlEnd = yamlAt + l.yaml.length * 110 + 600;
  const timeline = useTimeline(yamlEnd + 400);
  const { t } = timeline;

  const ownerSet = t >= ROLE_AT[0]! + ROLE_PICK_MS;
  const certified = t >= CERTIFY_AT;
  const status = certified ? l.status.certified : ownerSet ? l.status.draft : l.status.ungoverned;
  const done =
    (ownerSet ? 1 : 0) +
    (t >= ROLE_AT[1]! + ROLE_PICK_MS ? 1 : 0) +
    (t >= COLUMN_AT + 1200 ? 1 : 0) +
    (t >= RESULT_AT ? 1 : 0) +
    (certified ? 1 : 0);

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      {/* Status and checklist */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#0a0a0a] pb-3">
        <span
          className={cn(
            "px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-300",
            certified ? "bg-accent text-black" : ownerSet ? "border border-[#0a0a0a] text-[#0a0a0a]" : "border border-dashed border-[#0a0a0a]/40 text-[#0a0a0a]/55",
          )}
        >
          {status}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-24 bg-[#0a0a0a]/10">
            <span className="block h-full bg-[#0a0a0a] transition-[width] duration-500" style={{ width: `${done * 20}%` }} />
          </span>
          <span className="font-mono text-[11px] text-[#0a0a0a]/65">{l.done(done)}</span>
          <PressButton t={t} at={CERTIFY_AT} label={l.certify} done={`✓ ${l.status.certified}`} />
        </span>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {/* Ownership */}
          <section>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">{l.ownership}</h4>
            <ul className="mt-1.5 space-y-1.5">
              {l.roles.map((r, i) => {
                const at = ROLE_AT[i]!;
                const assigned = t >= at + ROLE_PICK_MS;
                const picking = t >= at && !assigned;
                return (
                  <li key={r.role} className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-[12.5px]">
                    <span className="font-semibold">{r.role}</span>
                    <span
                      className={cn(
                        "flex min-h-[26px] items-center justify-between gap-2 border px-2 py-0.5",
                        assigned ? "border-[#0a0a0a]" : "border-[#0a0a0a]/25",
                      )}
                    >
                      {assigned ? (
                        <span className="flex items-center gap-1.5">
                          <span className="bg-[#0a0a0a] px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white">
                            {l.group}
                          </span>
                          {r.who}
                        </span>
                      ) : picking ? (
                        <span className="font-mono text-[12px]">
                          {typed(r.query, t, at + 100, 14)}
                          <Caret on />
                        </span>
                      ) : (
                        <span className="text-[#0a0a0a]/45">{l.nobody}</span>
                      )}
                      {!assigned ? (
                        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a]/55">
                          {l.assign}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Columns */}
          <section>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">{l.columns}</h4>
            <table className="mt-1 w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#0a0a0a]">
                  {l.columnHeads.map((h) => (
                    <th key={h} className="py-1 pr-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#0a0a0a]/55">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {l.columnRows.map((row, i) => {
                  const set = t >= COLUMN_AT + i * 400;
                  return (
                    <tr key={row.name} className={cn("border-b border-[#0a0a0a]/10 transition-colors duration-300", set && t < COLUMN_AT + i * 400 + 500 && "bg-accent/40")}>
                      <td className="py-1 pr-2 font-mono">{row.name}</td>
                      <td className="py-1 pr-2">{row.cls}</td>
                      <td className="py-1 font-mono text-[11px]">
                        {set ? row.to : <span className="text-[#0a0a0a]/45">{row.from}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          {/* Quality */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">{l.quality}</h4>
              <PressButton t={t} at={RULE_AT} label={`+ ${l.addRule}`} className="px-2 py-0.5 text-[9px]" />
            </div>
            <ul className="mt-1.5 space-y-1 text-[12px]">
              {l.rules.map((rule) => (
                <li key={rule.rule} className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-flex size-4 items-center justify-center bg-accent font-mono text-[10px] font-bold text-black">✓</span>
                  {rule.rule}
                </li>
              ))}
              <li className="flex items-center gap-2" style={{ opacity: step(t, RULE_AT + 200, 250) }}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-4 items-center justify-center font-mono text-[10px] font-bold",
                    t >= RESULT_AT ? "bg-accent text-black" : "border border-[#0a0a0a]/40",
                  )}
                >
                  {t >= RESULT_AT ? "✓" : ""}
                </span>
                <span className="font-mono text-[11.5px]">
                  {typed(l.rule, t, RULE_AT + 300, 40)}
                  <Caret on={t >= RULE_AT + 300 && t < typedEnd(l.rule, RULE_AT + 300, 40)} />
                </span>
              </li>
            </ul>
            <div className="mt-2 flex items-center gap-2" style={{ opacity: step(t, RUN_AT - 300, 250) }}>
              <PressButton t={t} at={RUN_AT} label={l.runNow} className="px-2 py-0.5 text-[9px]" />
              {t >= RUN_AT && t < RESULT_AT ? (
                <span aria-hidden="true" className="cl-spin inline-block size-3 border-2 border-[#0a0a0a] border-t-transparent" />
              ) : null}
              <span className="font-mono text-[11px]" style={{ opacity: step(t, RESULT_AT, 250) }}>
                {l.result}
              </span>
            </div>
          </section>

          {/* Usage */}
          <section style={{ opacity: 0.3 + 0.7 * step(t, USAGE_AT, 400) }}>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">{l.usage}</h4>
            <div className="mt-1.5 flex items-end gap-4">
              <dl className="flex gap-4">
                {l.usageStats.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#0a0a0a]/55">{label}</dt>
                    <dd className="font-hero text-2xl leading-none">{value}</dd>
                  </div>
                ))}
              </dl>
              <span aria-hidden="true" className="ml-auto flex h-8 items-end gap-0.5">
                {SPARK.map((v, i) => (
                  <span
                    key={i}
                    className="w-1.5 bg-[#0a0a0a]"
                    style={{ height: `${(v / 15) * 32 * step(t, USAGE_AT + 100 + i * 50, 300)}px` }}
                  />
                ))}
              </span>
            </div>
            <p className="mt-1 font-mono text-[10.5px] text-[#0a0a0a]/65">{l.through}</p>
          </section>

          {/* Data contract */}
          <section>
            <PressButton t={t} at={EXPORT_AT} label={`↓ ${l.export}`} className="px-2 py-0.5 text-[9px]" />
            <pre className="mt-1.5 max-h-[150px] min-h-[150px] overflow-hidden border border-[#0a0a0a]/25 bg-[#f6f6f6] p-2 font-mono text-[10.5px] leading-[1.45]">
              {l.yaml.map((line, i) => (
                <div key={`${i}-${line}`} style={{ opacity: step(t, yamlAt + i * 110, 120) }}>
                  {line}
                </div>
              ))}
            </pre>
          </section>
        </div>
      </div>
    </DemoFrame>
  );
}
