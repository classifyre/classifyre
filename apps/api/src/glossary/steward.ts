import { BadRequestException } from '@nestjs/common';
import { principalError } from '../governance/governance-rules';

/**
 * A term's steward is a person or group of the tenant (`user:<id>`,
 * `group:<id>`), the same principals assets name
 * (docs/prd/GOV-governed-data-assets.md R11). Free text was migrated
 * (`20261112130000_glossary_steward_ref`): what matched a person became a
 * reference, the rest moved to the notes.
 */
export function isStewardRef(value: string): boolean {
  return principalError('STEWARD', value) === null;
}

/** For people and agents: a reference or nothing, never text. */
export function stewardRefOrThrow(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (!isStewardRef(trimmed)) {
    throw new BadRequestException(
      'steward names a person (user:<id>) or a group (group:<id>) of this tenant.',
    );
  }
  return trimmed;
}

/**
 * For imports (CSV, SKOS, glossary packs) written by hand or elsewhere: a
 * reference is kept; text cannot name anyone here, so it goes to the notes.
 */
export function stewardFromImport(
  value: string | null | undefined,
  notes: string | null | undefined,
): { steward: string | null; notes: string | null } {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || isStewardRef(trimmed)) {
    return { steward: trimmed || null, notes: notes ?? null };
  }
  const line = `Steward (as imported): ${trimmed}`;
  const existing = notes?.trim() ?? '';
  return {
    steward: null,
    notes: existing.includes(line)
      ? existing
      : existing
        ? `${existing}\n\n${line}`
        : line,
  };
}
