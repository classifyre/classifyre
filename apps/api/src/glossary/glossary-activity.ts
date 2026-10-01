import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

const logger = new Logger('GlossaryActivity');

export type GlossaryActivityType =
  | 'TERM_CREATED'
  | 'TERM_UPDATED'
  | 'TERM_APPROVED'
  | 'TERM_UNAPPROVED'
  | 'TERM_DEPRECATED'
  | 'TERM_REINSTATED'
  | 'TERM_DELETED'
  | 'TERM_KIND_CHANGED'
  | 'TERM_KEY_CHANGED'
  | 'ALIAS_PROPOSED'
  | 'SCHEME_CREATED'
  | 'SCHEME_UPDATED'
  | 'SCHEME_DELETED'
  | 'RELATION_ADDED'
  | 'RELATION_APPROVED'
  | 'RELATION_REMOVED'
  | 'BINDING_CREATED'
  | 'BINDING_APPROVED'
  | 'BINDING_DISABLED'
  | 'BINDING_ENABLED'
  | 'BINDING_DELETED'
  | 'BINDING_REVERTED'
  | 'LINK_ADDED'
  | 'LINK_REMOVED'
  | 'PROPOSAL_DECIDED'
  | 'IMPORTED'
  | 'PACK_INSTALLED'
  | 'PACK_UNINSTALLED';

export interface GlossaryActivityEntry {
  type: GlossaryActivityType;
  actor?: string | null;
  termId?: string | null;
  schemeId?: string | null;
  relationId?: string | null;
  bindingId?: string | null;
  payload?: Prisma.InputJsonValue;
}

type ActivityWriter = Pick<PrismaService, 'glossaryActivity'> | Prisma.TransactionClient;

/**
 * Append to `glossary_activities` (SL1 R11): every change to a term, scheme,
 * relation or binding, with who made it and a before/after summary. The
 * activity is a record, not part of the change: a failure to write it is logged
 * and never fails the change itself.
 */
export async function recordGlossaryActivity(
  prisma: ActivityWriter,
  entry: GlossaryActivityEntry,
): Promise<void> {
  try {
    await prisma.glossaryActivity.create({
      data: {
        type: entry.type,
        actor: entry.actor ?? null,
        termId: entry.termId ?? null,
        schemeId: entry.schemeId ?? null,
        relationId: entry.relationId ?? null,
        bindingId: entry.bindingId ?? null,
        payload: entry.payload,
      },
    });
  } catch (error) {
    logger.warn(
      `Could not record glossary activity ${entry.type}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
