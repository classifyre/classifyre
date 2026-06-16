import { createHash } from 'node:crypto';
import {
  DEFAULT_LABEL_WEIGHT,
  LABEL_WEIGHTS,
  MAX_VALUE_LENGTH,
} from './correlation.constants';

/**
 * Label-specific normalization is the *only* place the correlation engine knows
 * anything about what a finding means. Everything downstream treats values as
 * opaque tokens, so new (including custom) labels work without code changes.
 */

/** Collapse a label to a stable lookup key: lowercase, non-alnum → '_'. */
export function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Weight for a finding label, defaulting for unknown/custom labels. */
export function weightForLabel(label: string): number {
  return LABEL_WEIGHTS[normalizeLabel(label)] ?? DEFAULT_LABEL_WEIGHT;
}

/**
 * Normalize a raw finding value for the given label. Returns null when the
 * value carries no correlatable signal (empty, or absurdly long).
 */
export function normalizeValue(label: string, raw: string): string | null {
  if (raw == null) return null;
  const key = normalizeLabel(label);
  let value: string;

  if (key === 'email') {
    value = raw.trim().toLowerCase();
  } else if (key === 'phone') {
    // Keep a leading '+' (country code) and digits only.
    const digits = raw.replace(/[^\d+]/g, '');
    value = digits.startsWith('+')
      ? `+${digits.slice(1).replace(/\D/g, '')}`
      : digits.replace(/\D/g, '');
  } else if (key === 'person' || key === 'name') {
    value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  } else if (key === 'url' || key === 'domain') {
    value = raw.trim().toLowerCase().replace(/\/+$/, '');
  } else {
    // Generic: trim + collapse internal whitespace, preserve case-insensitively.
    value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  if (!value) return null;
  if (value.length > MAX_VALUE_LENGTH) return null;
  return value;
}

/** sha256 hex digest. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Reverse-index key for a (label, normalizedValue) pair. */
export function valueHash(label: string, normalizedValue: string): string {
  return sha256(`${normalizeLabel(label)}:${normalizedValue}`);
}

/** Hash of a set of value hashes (order-independent) — used for signatures. */
export function hashSet(hashes: Iterable<string>): string {
  const sorted = Array.from(new Set(hashes)).sort();
  return sha256(sorted.join('|'));
}
