import type { GlossaryEntityType } from '@prisma/client';
import { normalizeLabel } from '../correlation/value-normalizer';
import { ENTITY_MIN_FOLD_CHARS } from './entities.constants';

/**
 * Which finding labels take part in entity resolution (G5 R5).
 *
 * Only two families do: labels whose value is a *name* (a person, an
 * organisation, a place) and labels whose value is an *identifier* (an IBAN, a
 * VAT number, an e-mail address). Tags, dates, URLs and free text never do —
 * resolution must not make correlation noisier (field report P6).
 *
 * Labels are compared in the value index's own normal form
 * ({@link normalizeLabel}), so `EMAIL_ADDRESS`, `entity:organization` and
 * `Full Name` are `email_address`, `entity_organization` and `full_name` here.
 */

/** The entity types a name label can name. `ANY` is a bare "name". */
export type NameLabelType = 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'ANY';

/**
 * Name labels, by the last word of the label: `person`, `entity_person` and
 * `pii_person` are all a person's name.
 */
const NAME_STEMS: Record<string, NameLabelType> = {
  person: 'PERSON',
  per: 'PERSON',
  people: 'PERSON',
  full_name: 'PERSON',
  person_name: 'PERSON',
  organization: 'ORGANIZATION',
  organisation: 'ORGANIZATION',
  org: 'ORGANIZATION',
  company: 'ORGANIZATION',
  company_name: 'ORGANIZATION',
  legal_entity: 'ORGANIZATION',
  location: 'LOCATION',
  loc: 'LOCATION',
  gpe: 'LOCATION',
  place: 'LOCATION',
  name: 'ANY',
};

/**
 * Identifier labels shipped with the product: the PII and secrets detectors'
 * exact, non-phonetic outputs. A workspace adds its own (a register number, a
 * customer id) in the entity configuration, and a label an operator files an
 * identifier under joins the set by itself.
 */
export const SHIPPED_IDENTIFIER_LABELS: readonly string[] = [
  'email',
  'email_address',
  'phone',
  'phone_number',
  'iban',
  'iban_code',
  'bic',
  'swift_code',
  'credit_card',
  'ssn',
  'us_ssn',
  'us_itin',
  'passport',
  'us_passport',
  'national_id',
  'tax_id',
  'vat',
  'vat_number',
  'medical_license',
  'driver_license',
  'us_driver_license',
  'us_bank_number',
  'account_number',
  'uk_nhs',
  'nhs_number',
  'crypto',
];

/** Labels that are never linkable, whatever a configuration says. */
function neverLinkable(label: string): boolean {
  return (
    !label ||
    // A Tag finding's value is the reason a connector wrote, not a name.
    label.startsWith('tag_') ||
    label === 'tag' ||
    label === 'date_time' ||
    label === 'date'
  );
}

export interface EntityLabelConfig {
  /** Custom labels declared as names. */
  nameLabels: Record<string, NameLabelType>;
  /** Identifier labels on top of the shipped set. */
  identifierLabels: string[];
}

export const EMPTY_LABEL_CONFIG: EntityLabelConfig = {
  nameLabels: {},
  identifierLabels: [],
};

/** What kind of name a label carries, or null when it is not a name label. */
export function nameLabelType(
  rawLabel: string,
  config: EntityLabelConfig = EMPTY_LABEL_CONFIG,
): NameLabelType | null {
  const label = normalizeLabel(rawLabel);
  if (neverLinkable(label)) return null;
  const configured = config.nameLabels[label];
  if (configured) return configured;
  if (NAME_STEMS[label]) return NAME_STEMS[label];
  for (const [stem, type] of Object.entries(NAME_STEMS)) {
    if (stem !== 'name' && label.endsWith(`_${stem}`)) return type;
  }
  return null;
}

export function isIdentifierLabel(
  rawLabel: string,
  config: EntityLabelConfig = EMPTY_LABEL_CONFIG,
): boolean {
  const label = normalizeLabel(rawLabel);
  if (neverLinkable(label)) return false;
  return (
    SHIPPED_IDENTIFIER_LABELS.includes(label) ||
    config.identifierLabels.includes(label)
  );
}

/** Whether a label takes part in resolution at all (R5). */
export function isLinkableLabel(
  rawLabel: string,
  config: EntityLabelConfig = EMPTY_LABEL_CONFIG,
): boolean {
  return (
    nameLabelType(rawLabel, config) !== null ||
    isIdentifierLabel(rawLabel, config)
  );
}

/**
 * Whether a label may be filed as an identifier by a person. Wider than
 * {@link isIdentifierLabel}: an operator who promotes a register number names
 * its label themselves, and that choice is what declares the label.
 */
export function canBeIdentifierLabel(rawLabel: string): boolean {
  return !neverLinkable(normalizeLabel(rawLabel));
}

/** Whether a name of this kind can be the name of an entity of this type. */
export function nameTypeFits(
  type: NameLabelType,
  entityType: GlossaryEntityType,
): boolean {
  if (type === 'ANY') return true;
  if (type === 'PERSON') return entityType === 'PERSON';
  if (type === 'ORGANIZATION') return entityType === 'ORGANIZATION';
  return entityType === 'LOCATION';
}

/**
 * The name labels an entity's name and aliases are indexed under: the labels
 * this workspace's detectors actually produce (and the ones it declared) that
 * classify as the entity's type — which is how `entity_organization` is
 * covered, and why an entity does not carry a row for every label a detector
 * might one day emit. A name label that appears later is picked up by the
 * resolution worker, which regenerates the values (see `syncedLabels`).
 */
export function nameLabelsFor(
  entityType: GlossaryEntityType,
  observed: Iterable<string>,
  config: EntityLabelConfig = EMPTY_LABEL_CONFIG,
): string[] {
  const out = new Set<string>();
  const consider = (label: string) => {
    const type = nameLabelType(label, config);
    if (type && nameTypeFits(type, entityType)) out.add(normalizeLabel(label));
  };
  for (const label of Object.keys(config.nameLabels)) consider(label);
  for (const label of observed) consider(label);
  return [...out].sort();
}

/**
 * A name with everything but letters and digits removed, diacritics folded:
 * "Acme Holding G.m.b.H." and "ACME Holding GmbH" both fold to
 * `acmeholdinggmbh`. A second blocking key next to the phonetic fingerprint,
 * which punctuation inside a word defeats. Null when too short to mean much.
 */
export function foldKey(normalizedValue: string): string | null {
  const folded = normalizedValue
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return folded.length >= ENTITY_MIN_FOLD_CHARS ? folded : null;
}
