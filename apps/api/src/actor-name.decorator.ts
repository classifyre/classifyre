import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export const ACTOR_NAME_HEADER = 'x-actor-name';
const MAX_ACTOR_CHARS = 64;

/**
 * Parse the self-declared display name a browser sends as `X-Actor-Name`.
 *
 * Interim identity (CASE_BOARD_PRD §5.12, open question Q1): the app has no
 * user model yet, so this is *attribution*, not authorisation — anyone can
 * claim any name. The web client percent-encodes the value because header
 * values must be Latin-1 and names are not.
 */
export function parseActorName(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  if (typeof value !== 'string') return undefined;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not percent-encoded (curl, scripts): take it as typed.
  }
  // Control characters would corrupt the timeline rendering; blank them.
  const printable = Array.from(decoded, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  }).join('');
  const cleaned = printable
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ACTOR_CHARS)
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** `@ActorName() actor: string | undefined` — see {@link parseActorName}. */
export const ActorName = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return parseActorName(request.headers?.[ACTOR_NAME_HEADER]);
  },
);
