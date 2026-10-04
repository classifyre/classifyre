import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  DetectorType,
  GlossaryBindingMode,
  GlossaryLookupMatch,
} from '@prisma/client';
import { glossaryNorm } from '../../glossary/glossary-norm';

/**
 * Contract C9: the binding spec — what a binding says, independent of who made
 * it or its lifecycle. REST, MCP, packs and SL4 suggestions all speak it.
 *
 * A binding is a selection from the observed vocabulary (rule SL-7): a
 * detector output, optionally narrowed to observed values or read as codes, or
 * an asset metadata field. It never carries a pattern.
 */
export interface BindingOutputSelector {
  detectorType: DetectorType;
  /** Required exactly when detectorType is CUSTOM. */
  customDetectorKey?: string | null;
  findingType: string;
}

export interface BindingSpec {
  mode: GlossaryBindingMode;
  output?: BindingOutputSelector | null;
  /** METADATA*: a dotted path below `metadata`, depth ≤ 2. */
  field?: string | null;
  /** *_VALUES: the chosen values (normalised on save). */
  values?: string[];
  splitDelimiter?: string | null;
  lookup?: {
    schemeId?: string;
    schemeKey?: string;
    match: GlossaryLookupMatch;
  } | null;
  /** The target concept (by key, C8), or termId. */
  termKey?: string | null;
  termId?: string | null;
  noMeaning?: boolean;
  /** Empty = every source. */
  sourceIds?: string[];
  confidence?: number;
}

/** The binding as stored and as the compiler sees it. */
export interface CompiledBinding {
  id: string;
  mode: GlossaryBindingMode;
  detectorType: DetectorType | null;
  customDetectorKey: string | null;
  findingType: string | null;
  metadataPath: string | null;
  values: string[];
  splitDelimiter: string | null;
  termId: string | null;
  lookupSchemeId: string | null;
  lookupMatch: GlossaryLookupMatch | null;
  noMeaning: boolean;
  sourceIds: string[];
  confidence: number;
}

export const MAX_BINDING_VALUES = 1_000;
export const MAX_BINDINGS = 5_000;
const METADATA_PATH =
  /^[A-Za-z0-9_\-:@$ ]{1,100}(\.[A-Za-z0-9_\-:@$ ]{1,100})?$/;

export function isOutputMode(mode: GlossaryBindingMode): boolean {
  return (
    mode === 'OUTPUT' || mode === 'OUTPUT_VALUES' || mode === 'OUTPUT_LOOKUP'
  );
}

export function isLookupMode(mode: GlossaryBindingMode): boolean {
  return mode === 'OUTPUT_LOOKUP' || mode === 'METADATA_LOOKUP';
}

export function isValuesMode(mode: GlossaryBindingMode): boolean {
  return mode === 'OUTPUT_VALUES' || mode === 'METADATA_VALUES';
}

/** Split a value by the binding's delimiter (multi-valued tags), trimmed. */
export function splitValue(value: string, delimiter: string | null): string[] {
  if (!delimiter) return [value];
  return value.split(delimiter);
}

/**
 * Validate a binding's shape (SL2 §10 constraints), refusing with HTTP 400
 * naming the field. Returns the normalised selector part; target resolution
 * (term key → id, scheme key → id) is the service's job.
 */
export function validateBindingShape(
  spec: BindingSpec,
): Omit<CompiledBinding, 'id' | 'termId' | 'lookupSchemeId'> {
  const mode = spec.mode;
  const allowed: GlossaryBindingMode[] = [
    'OUTPUT',
    'OUTPUT_VALUES',
    'OUTPUT_LOOKUP',
    'METADATA_VALUES',
    'METADATA_LOOKUP',
  ];
  if (!allowed.includes(mode)) {
    throw new BadRequestException(`mode: unknown binding mode ${String(mode)}`);
  }
  let detectorType: DetectorType | null = null;
  let customDetectorKey: string | null = null;
  let findingType: string | null = null;
  let metadataPath: string | null = null;
  if (isOutputMode(mode)) {
    if (!spec.output?.detectorType) {
      throw new BadRequestException('output.detectorType is required');
    }
    if (!spec.output.findingType?.trim()) {
      throw new BadRequestException('output.findingType is required');
    }
    detectorType = spec.output.detectorType;
    findingType = spec.output.findingType.trim();
    const key = spec.output.customDetectorKey?.trim() || null;
    if (detectorType === 'CUSTOM' && !key) {
      throw new BadRequestException(
        'output.customDetectorKey is required for CUSTOM detectors',
      );
    }
    if (detectorType !== 'CUSTOM' && key) {
      throw new BadRequestException(
        'output.customDetectorKey is only for CUSTOM detectors',
      );
    }
    customDetectorKey = key;
    if (spec.field) {
      throw new BadRequestException('field: output bindings take no field');
    }
  } else {
    const path = spec.field?.trim();
    if (!path) throw new BadRequestException('field is required');
    if (!METADATA_PATH.test(path)) {
      throw new BadRequestException(
        'field: a top-level or one-level-nested metadata key (a or a.b)',
      );
    }
    metadataPath = path;
    if (spec.output) {
      throw new BadRequestException('output: metadata bindings take no output');
    }
  }

  const rawValues = spec.values ?? [];
  const values = [
    ...new Set(
      rawValues.map((value) => glossaryNorm(String(value))).filter(Boolean),
    ),
  ];
  if (isValuesMode(mode)) {
    if (values.length < 1) {
      throw new BadRequestException('values: choose at least one value');
    }
    if (values.length > MAX_BINDING_VALUES) {
      throw new BadRequestException(
        `values: at most ${MAX_BINDING_VALUES} values`,
      );
    }
  } else if (values.length) {
    throw new BadRequestException(`values: only for *_VALUES modes`);
  }

  const noMeaning = spec.noMeaning === true;
  let lookupMatch: GlossaryLookupMatch | null = null;
  if (isLookupMode(mode)) {
    if (!spec.lookup || (!spec.lookup.schemeId && !spec.lookup.schemeKey)) {
      throw new BadRequestException('lookup.scheme is required for lookups');
    }
    if (spec.lookup.match !== 'CODES' && spec.lookup.match !== 'ANY') {
      throw new BadRequestException('lookup.match is CODES or ANY');
    }
    if (spec.termId || spec.termKey) {
      throw new BadRequestException('termKey: lookups take no fixed term');
    }
    if (noMeaning) {
      throw new BadRequestException('noMeaning: not for lookups');
    }
    lookupMatch = spec.lookup.match;
  } else {
    if (spec.lookup) {
      throw new BadRequestException('lookup: only for *_LOOKUP modes');
    }
    if (!noMeaning && !spec.termId && !spec.termKey) {
      throw new BadRequestException('termKey is required');
    }
    if (noMeaning && (spec.termId || spec.termKey)) {
      throw new BadRequestException(
        'termKey: a "no meaning" binding has no term',
      );
    }
  }
  const splitDelimiter = spec.splitDelimiter ? spec.splitDelimiter : null;
  if (splitDelimiter && splitDelimiter.length > 8) {
    throw new BadRequestException('splitDelimiter: at most 8 characters');
  }
  const confidence =
    spec.confidence === undefined || spec.confidence === null
      ? 1
      : Number(spec.confidence);
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
    throw new BadRequestException('confidence: in (0, 1]');
  }
  return {
    mode,
    detectorType,
    customDetectorKey,
    findingType,
    metadataPath,
    values: values.sort(),
    splitDelimiter,
    lookupMatch,
    noMeaning,
    sourceIds: [...new Set(spec.sourceIds ?? [])].sort(),
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** sha256 of the normalised selector + target: one binding cannot exist twice. */
export function bindingFingerprint(
  binding: Omit<CompiledBinding, 'id' | 'confidence'>,
): string {
  const canonical = JSON.stringify([
    binding.mode,
    binding.detectorType,
    binding.customDetectorKey,
    binding.findingType,
    binding.metadataPath,
    binding.values,
    binding.splitDelimiter,
    binding.termId,
    binding.lookupSchemeId,
    binding.lookupMatch,
    binding.noMeaning,
    binding.sourceIds,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** A stable string for an output selector, for events, logs and keys. */
export function outputKey(output: {
  detectorType: string | null;
  customDetectorKey?: string | null;
  findingType: string | null;
}): string {
  return `${output.detectorType ?? ''}|${output.customDetectorKey ?? ''}|${output.findingType ?? ''}`;
}

/** Kept upper-case when humanising built-in type names. */
const ACRONYMS = new Set([
  'IBAN',
  'IP',
  'URL',
  'NHS',
  'SSN',
  'VAT',
  'ABN',
  'ACN',
  'UEN',
  'NIF',
  'NIE',
  'AHV',
  'NRP',
  'ID',
  'AU',
  'US',
  'UK',
  'EU',
  'IT',
  'ES',
  'CH',
  'DE',
  'AT',
  'PL',
  'FI',
  'SVNR',
  'PESEL',
  'AWS',
  'JWT',
  'API',
]);

const BUILTIN_LABELS: Record<string, string> = {
  PII: 'PII',
  SECRETS: 'Secrets',
  YARA: 'YARA',
  BROKEN_LINKS: 'Broken links',
  CODE_SECURITY: 'Code security',
};

/**
 * The human label of an output (SL2 §5.3). The UI never shows the raw tuple
 * alone: `IBAN_CODE` reads "IBAN code · PII", `tag:legal_form` reads
 * "legal_form · tag", `classification:risk:high` reads "risk = high".
 */
export function vocabularyLabel(output: {
  detectorType: string | null;
  customDetectorKey?: string | null;
  customDetectorName?: string | null;
  findingType: string | null;
}): { label: string; detail: string } {
  const type = output.findingType ?? '';
  const detector =
    output.detectorType === 'CUSTOM'
      ? (output.customDetectorName ?? output.customDetectorKey ?? 'custom')
      : (BUILTIN_LABELS[output.detectorType ?? ''] ??
        output.detectorType ??
        '');
  if (type.startsWith('tag:')) {
    return { label: type.slice(4), detail: 'tag' };
  }
  if (type.startsWith('classification:')) {
    const parts = type.slice('classification:'.length).split(':');
    const value = parts.pop() ?? '';
    return {
      label: parts.length ? `${parts.join(':')} = ${value}` : value,
      detail: detector,
    };
  }
  if (type.startsWith('entity:'))
    return { label: type.slice(7), detail: detector };
  if (type.startsWith('regex:'))
    return { label: type.slice(6), detail: detector };
  if (output.detectorType !== 'CUSTOM' && /^[A-Z0-9_]+$/.test(type)) {
    const words = type.split('_').filter(Boolean);
    const human = words
      .map((word, index) => {
        if (ACRONYMS.has(word)) return word;
        const lower = word.toLowerCase();
        return index === 0
          ? lower.charAt(0).toUpperCase() + lower.slice(1)
          : lower;
      })
      .join(' ');
    return { label: human, detail: detector };
  }
  return { label: type, detail: detector };
}

/** Humanise a label for lexical comparison (SL4 G-1). */
export function humaniseOutput(findingType: string): string {
  let value = findingType;
  for (const prefix of ['tag:', 'entity:', 'regex:', 'classification:']) {
    if (value.startsWith(prefix)) value = value.slice(prefix.length);
  }
  return glossaryNorm(value.replace(/[_:.-]+/g, ' '));
}
