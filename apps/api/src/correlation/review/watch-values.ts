/**
 * What an inquiry opened from duplicate review watches for.
 *
 * Not the labels: a watch on "any IBAN" fires on every invoice in the source,
 * and the labels are spelled the way correlation normalises them
 * (`iban_code`) while findings carry the detector's own type (`IBAN_CODE`), so
 * a watch built from them matched nothing at all. A pair is a pair because of
 * particular values; the watch fires when one of those turns up again.
 */

export interface SharedValue {
  label: string;
  value: string;
  weight: number;
}

/** Values carried by the strongest shared labels, at most `cap` of them. */
export function valuesToWatch(shared: SharedValue[], cap = 10): SharedValue[] {
  const strongest = Math.max(0, ...shared.map((s) => s.weight));
  if (strongest <= 0) return [];
  // Half the strongest weight: an IBAN (6) brings a phone (4) along, not the
  // dates (1) every document of the month shares.
  const seen = new Set<string>();
  return shared
    .filter((s) => s.weight > 0 && s.weight >= strongest / 2)
    .sort((a, b) => b.weight - a.weight)
    .filter((s) => {
      const key = `${s.label}\u0000${s.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, cap);
}

/**
 * A pattern for a normalised value as a detector found it: letters in either
 * case, any spacing or punctuation between characters. "gb53qxhb…" is printed
 * "GB53 QXHB …", "02079460588" is "020 7946 0588". Inquiry value patterns are
 * case-sensitive, so the pattern carries the case itself.
 */
export function valuePattern(value: string): string {
  const chars = [...value].filter((c) => /[\p{L}\p{N}]/u.test(c));
  return chars
    .map((c) => {
      const lower = c.toLowerCase();
      const upper = c.toUpperCase();
      return lower === upper ? c : `[${lower}${upper}]`;
    })
    .join('[\\s.\\-/]*');
}
