import { Logger } from '@nestjs/common';
import { AiProviderError } from '../ai';

const logger = new Logger('ContextBudget');

/**
 * Token budgeting for agent prompts. Instead of truncating (losing data), the
 * item list (finding groups, candidate inquiries…) is split into chunks that
 * each fit the provider's context window; the model assesses every chunk and
 * the outputs are merged.
 *
 * Conservative 3 chars/token for JSON-heavy prompts; reserve room for the
 * schema-validated response and provider overhead.
 */
const CHARS_PER_TOKEN = 3;
const RESERVED_TOKENS = 2500;
const DEFAULT_CONTEXT_TOKENS = 100_000;

export function promptCharBudget(
  contextSize: number | null | undefined,
): number {
  const tokens = contextSize && contextSize > 0 ? contextSize : DEFAULT_CONTEXT_TOKENS;
  const usable = Math.max(1_000, tokens - RESERVED_TOKENS);
  return usable * CHARS_PER_TOKEN;
}

/** Split items so that fixedChars + Σ itemChars(chunk) stays within budget. */
export function chunkByBudget<T>(
  items: T[],
  fixedChars: number,
  budgetChars: number,
  itemChars: (item: T) => number,
): T[][] {
  const room = Math.max(budgetChars - fixedChars, 1_000);
  const chunks: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = itemChars(item);
    if (current.length > 0 && used + size > room) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function isInputTooLong(err: unknown): boolean {
  if (!(err instanceof AiProviderError)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('input too long') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('too many tokens') ||
    msg.includes('reduce the length')
  );
}

/**
 * Run `call` over each chunk; when the provider still reports "input too
 * long" (our chars/token estimate is heuristic) the offending chunk is split
 * in half and re-assessed — no data is dropped.
 */
export async function runChunked<T, R>(
  chunks: T[][],
  call: (chunk: T[], part: number, totalParts: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = chunks.map((c) => ({ chunk: c, depth: 0 }));
  const totalParts = chunks.length;
  let part = 0;
  while (queue.length > 0) {
    const { chunk, depth } = queue.shift()!;
    part++;
    try {
      results.push(await call(chunk, part, Math.max(totalParts, part)));
    } catch (err) {
      if (isInputTooLong(err) && chunk.length > 1 && depth < 4) {
        logger.warn(
          `Provider rejected chunk of ${chunk.length} item(s) as too long — splitting in half`,
        );
        const mid = Math.ceil(chunk.length / 2);
        queue.unshift(
          { chunk: chunk.slice(0, mid), depth: depth + 1 },
          { chunk: chunk.slice(mid), depth: depth + 1 },
        );
        part--;
        continue;
      }
      throw err;
    }
  }
  return results;
}

/**
 * Merge multi-chunk decision outputs: concatenate decisions, but drop the
 * per-chunk NO_ACTION fillers when any chunk produced a real decision;
 * memory writes are deduped by kind+key.
 */
export function mergeDecisionOutputs<
  D extends { action: string },
  M extends { kind: string; key: string },
>(outputs: Array<{ decisions: D[]; memoryWrites: M[] }>): {
  decisions: D[];
  memoryWrites: M[];
} {
  const decisions = outputs.flatMap((o) => o.decisions);
  const real = decisions.filter((d) => d.action !== 'NO_ACTION');
  const merged =
    real.length > 0 ? real : decisions.slice(0, 1); // keep one documented no-op

  const seen = new Set<string>();
  const memoryWrites: M[] = [];
  for (const m of outputs.flatMap((o) => o.memoryWrites)) {
    const key = `${m.kind}:${m.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    memoryWrites.push(m);
  }
  return { decisions: merged, memoryWrites };
}
