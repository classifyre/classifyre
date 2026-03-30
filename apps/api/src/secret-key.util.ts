import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('SecretKeyUtil');

export function resolveApplicationSecretKey(): Buffer {
  const explicitKey = process.env.CLASSIFYRE_MASKED_CONFIG_KEY;
  if (explicitKey) {
    return parseSecretKey(explicitKey);
  }

  const passphrase = process.env.CLASSIFYRE_MASKED_CONFIG_PASSPHRASE;
  if (passphrase) {
    return deriveKeyFromPassphrase(passphrase);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CLASSIFYRE_MASKED_CONFIG_KEY (preferred) or CLASSIFYRE_MASKED_CONFIG_PASSPHRASE must be configured in production',
    );
  }

  logger.warn(
    'Using a development fallback key for masked config encryption and MCP token hashing. Set CLASSIFYRE_MASKED_CONFIG_KEY for secure deployments.',
  );
  return deriveKeyFromPassphrase('classifyre-dev-fallback-passphrase');
}

function parseSecretKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();

  if (trimmed.startsWith('base64:')) {
    return ensureKeySize(Buffer.from(trimmed.slice(7), 'base64'));
  }
  if (trimmed.startsWith('hex:')) {
    return ensureKeySize(Buffer.from(trimmed.slice(4), 'hex'));
  }

  const base64Candidate = Buffer.from(trimmed, 'base64');
  if (base64Candidate.length === 32) {
    return base64Candidate;
  }

  const hexCandidate = Buffer.from(trimmed, 'hex');
  if (hexCandidate.length === 32) {
    return hexCandidate;
  }

  const utf8Candidate = Buffer.from(trimmed, 'utf8');
  if (utf8Candidate.length === 32) {
    return utf8Candidate;
  }

  throw new Error(
    'CLASSIFYRE_MASKED_CONFIG_KEY must resolve to exactly 32 bytes (use base64:, hex:, or 32-char raw key)',
  );
}

function deriveKeyFromPassphrase(passphrase: string): Buffer {
  const salt =
    process.env.CLASSIFYRE_MASKED_CONFIG_SALT ||
    'classifyre-masked-config-v1-salt';
  return crypto.scryptSync(passphrase, salt, 32);
}

function ensureKeySize(key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error(
      'CLASSIFYRE_MASKED_CONFIG_KEY must decode to exactly 32 bytes',
    );
  }
  return key;
}
