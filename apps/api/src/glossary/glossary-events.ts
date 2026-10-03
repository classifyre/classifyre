import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * Aggregate domain events of the semantic layer (SL0 §4, F1).
 *
 * The integration architecture's outbound event catalogue does not exist in
 * this codebase yet, so these are in-process events: the binding cache, the
 * linker, the suggestion generators and the semantic map listen to them, and
 * the shapes below are what an outbound catalogue (G3) will publish. Every
 * event is aggregate-level — one per change or per job, never one per link.
 *
 * Emission is synchronous and listeners run in the emitter's async context,
 * which carries the namespace (CLS): a listener that touches Prisma or pg-boss
 * resolves the same tenant schema the change was made in.
 */
export type GlossaryEvent =
  | {
      type: 'glossary.term_changed';
      change:
        | 'created'
        | 'updated'
        | 'approved'
        | 'unapproved'
        | 'deprecated'
        | 'reinstated'
        | 'deleted';
      termId: string;
      key: string;
      kind: string;
      /** Whether labels (term, aliases, codes, hidden aliases) changed. */
      labelsChanged?: boolean;
      /**
       * Whether the change can alter what links to the term: its status,
       * labels, scheme or kind. Lookup bindings read all four, so each one
       * needs a linker backfill.
       */
      linkingChanged?: boolean;
      /** Key renames, so `term_ref` endpoints can stitch. */
      keys?: string[];
    }
  | {
      type: 'glossary.relation_changed';
      change: 'created' | 'approved' | 'deleted';
      relationId: string;
      relationType: string;
      fromTermId: string;
      toTermId: string;
    }
  | {
      type: 'glossary.scheme_changed';
      change: 'created' | 'updated' | 'deleted';
      schemeId: string;
      key: string;
    }
  | {
      type: 'glossary.imported';
      format: string;
      created: number;
      updated: number;
      skipped: number;
    }
  | {
      type: 'glossary.binding_changed';
      change: 'created' | 'approved' | 'disabled' | 'enabled' | 'deleted';
      bindingId: string;
      mode: string;
      output?: string;
      termKey?: string | null;
    }
  | {
      type: 'glossary.pack_installed';
      packKey: string;
      version: string;
      counts: Record<string, number>;
    }
  | {
      /** A derived semantic dataset was wiped in Cleanup (SL-9): rebuild it. */
      type: 'semantic.derived_cleared';
      dataset:
        | 'vocabulary'
        | 'semanticLinks'
        | 'suggestions'
        | 'semanticMap'
        | 'entities';
    }
  | {
      /** A manual ABOUT reference was added or removed (SL3 R5). */
      type: 'semantic.reference_changed';
      change: 'linked' | 'unlinked';
      termId: string;
      entityType: string;
      entityId: string;
    }
  | {
      type: 'semantic.links_updated';
      jobId: string;
      runId?: string | null;
      trigger: string;
      terms: Array<{ key: string; added: number; gone: number }>;
      durationMs: number;
    }
  | {
      /** An entity was created (G5): by a person, an agent or a source. */
      type: 'entity.created';
      termId: string;
      key: string;
      origin: string;
    }
  | {
      /** Entity A was merged into B (G5 R7). */
      type: 'entity.merged';
      fromTermId: string;
      fromKey: string;
      intoTermId: string;
      intoKey: string;
      valuesMoved: number;
      referencesMoved: number;
    }
  | {
      /** A resolution pass proposed values for review (G5 §6.2). */
      type: 'entity.candidates_pending';
      count: number;
      runId?: string | null;
      top: Array<{ key: string; term: string; count: number }>;
    }
  | {
      /**
       * The confirmed values of these entities changed, so their mentions
       * did: links, counters and watch snapshots follow. In-process only.
       */
      type: 'entity.values_changed';
      termIds: string[];
    }
  | {
      type: 'glossary.proposals_pending';
      threshold: number;
      counts: Record<string, number>;
    }
  | {
      type: 'glossary.proposal_decided';
      kind: string;
      decision: string;
      count: number;
    };

export type GlossaryEventType = GlossaryEvent['type'];

type Listener<T extends GlossaryEventType> = (
  event: Extract<GlossaryEvent, { type: T }>,
) => void | Promise<void>;

const logger = new Logger('GlossaryEvents');

/**
 * One bus per process. Services that publish or listen are provided by more
 * than one Nest module (the autopilot module re-provides several), so the bus
 * must not be an injectable instance — two instances would each hear half of
 * the events.
 */
class GlossaryEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: GlossaryEvent): void {
    logger.debug(`${event.type} ${JSON.stringify(event)}`);
    for (const listener of this.emitter.listeners(event.type)) {
      try {
        const result = (listener as (e: GlossaryEvent) => unknown)(event);
        if (result instanceof Promise) {
          result.catch((error: unknown) =>
            logger.warn(
              `Listener for ${event.type} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      } catch (error) {
        logger.warn(
          `Listener for ${event.type} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  on<T extends GlossaryEventType>(type: T, listener: Listener<T>): () => void {
    this.emitter.on(type, listener as (...args: unknown[]) => void);
    return () =>
      this.emitter.off(type, listener as (...args: unknown[]) => void);
  }
}

export const glossaryEvents = new GlossaryEventBus();
