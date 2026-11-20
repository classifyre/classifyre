/**
 * The invented customers behind the landing page's demos.
 *
 * Every name, account and address here is made up for the page (IBANs are
 * well-formed specimens, the e-mail domains are reserved `example.*`
 * domains, the tokens are obvious placeholders). The masks reproduce what
 * the product does, as documented at docs.classifyre.com/data-query:
 *
 *   redacted   → `****`
 *   last four  → `••••` + the last four characters (values of nine or more)
 *   hashed     → 16 hex characters, equal for equal values, so it still joins
 *   hidden     → the column is not in the result at all
 *
 * The hash below is a stand-in for the product's salted SHA-256: it only
 * has to be stable and look the part.
 */

import type { Locale } from "@/lib/locale";

export type MaskKind = "clear" | "redact" | "partial" | "hash" | "hidden";

export type SampleColumn = {
  key: "name" | "iban" | "email" | "city" | "total" | "token";
  /** Column name as it appears in SQL. */
  sql: string;
  mask: MaskKind;
};

export const SAMPLE_COLUMNS: readonly SampleColumn[] = [
  { key: "name", sql: "name", mask: "redact" },
  { key: "iban", sql: "iban", mask: "partial" },
  { key: "email", sql: "email", mask: "hash" },
  { key: "city", sql: "city", mask: "clear" },
  { key: "token", sql: "api_token", mask: "hidden" },
];


export type SampleRow = Record<SampleColumn["key"], string>;

/**
 * Rows per locale. The German page keeps Austrian customers (AT IBANs,
 * Graz, Linz, Wien); the English page uses neutral European ones so it
 * carries no country-specific context.
 */
const ROWS: Record<Locale, readonly SampleRow[]> = {
  en: [
    {
      name: "Emma Clarke",
      iban: "NL91 ABNA 0417 1643 00",
      email: "emma@example.com",
      city: "Amsterdam",
      total: "1,240.00",
      token: "tok_7Qe2x9",
    },
    {
      name: "Lucas Martin",
      iban: "BE68 5390 0754 7034",
      email: "lucas@example.com",
      city: "Brussels",
      total: "312.50",
      token: "tok_m81Kp3",
    },
    {
      name: "Sofia Rossi",
      iban: "DK50 0040 0440 1162 43",
      email: "sofia@example.org",
      city: "Copenhagen",
      total: "88.90",
      token: "tok_x0Pd5a",
    },
    {
      name: "Noah Jensen",
      iban: "NL69 INGB 0123 4567 89",
      email: "noah@example.net",
      city: "Rotterdam",
      total: "2,015.00",
      token: "tok_Zt4w8c",
    },
  ],
  de: [
    {
      name: "Anna Berger",
      iban: "AT61 1904 3002 3457 3201",
      email: "anna@example.at",
      city: "Graz",
      total: "1.240,00",
      token: "tok_7Qe2x9",
    },
    {
      name: "Lukas Hofer",
      iban: "AT48 3200 0000 1234 5864",
      email: "lukas@example.at",
      city: "Linz",
      total: "312,50",
      token: "tok_m81Kp3",
    },
    {
      name: "Marie Novak",
      iban: "DE89 3704 0044 0532 0130 00",
      email: "marie@example.de",
      city: "Wien",
      total: "88,90",
      token: "tok_x0Pd5a",
    },
    {
      name: "Jonas Weber",
      iban: "AT02 2011 1000 0123 4567",
      email: "jonas@example.org",
      city: "Salzburg",
      total: "2.015,00",
      token: "tok_Zt4w8c",
    },
  ],
};

/** The invented customers for a locale. */
export function sampleRows(locale: Locale): readonly SampleRow[] {
  return ROWS[locale] ?? ROWS.en;
}

/** The city the hero's regional analyst is filtered to: the first row's. */
export function sampleRowFilterCity(locale: Locale): string {
  return sampleRows(locale)[0]?.city ?? "";
}

/** Stable 16-hex stand-in for the product's hashed mask. */
export function sampleHash(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x5bd1e995) >>> 0;
  }
  return (
    a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
  ).slice(0, 16);
}

/** What a reader without clear reading sees in a cell. */
export function maskValue(kind: MaskKind, value: string): string {
  switch (kind) {
    case "redact":
      return "****";
    case "partial": {
      const compact = value.replace(/\s+/g, "");
      return compact.length >= 9 ? `••••${compact.slice(-4)}` : "****";
    }
    case "hash":
      return sampleHash(value);
    case "hidden":
      return "";
    default:
      return value;
  }
}
