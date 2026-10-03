import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { glossaryEvents } from '../glossary/glossary-events';
import { SemanticJobsScheduler } from './semantic-jobs.scheduler';
import { stitchTermRefs, TERM_REF_NODE } from './term-refs';
import { keyFromTermUrn } from '../glossary/glossary-norm';

let installed = false;

/**
 * Turns glossary changes into semantic work (SL3 R2, SL4, SL5 B6):
 * a binding or term status change becomes a linker backfill, a new key stitches
 * `term_ref` endpoints, and any change to meaning refreshes the map and the
 * suggestions. Listeners run in the emitter's namespace context.
 *
 * Installed once per process: the services that publish are provided by more
 * than one module, and a second installation would double every backfill.
 */
@Injectable()
export class SemanticEventsListener {
  private readonly logger = new Logger(SemanticEventsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SemanticJobsScheduler,
  ) {
    if (installed) return;
    installed = true;
    this.install();
  }

  private install(): void {
    glossaryEvents.on('glossary.binding_changed', async (event) => {
      // A binding created APPROVED emits `approved` right after; one created
      // as a DRAFT links nothing. Either way `created` needs no walk.
      if (event.change !== 'created') {
        await this.scheduler.scheduleBackfill({
          bindingIds: [event.bindingId],
          reason: `binding ${event.change}`,
        });
      }
      await this.scheduler.scheduleMapRebuild('binding changed');
      await this.scheduler.scheduleSuggestions({
        generators: ['binding'],
        reason: 'binding changed',
      });
    });

    glossaryEvents.on('glossary.term_changed', async (event) => {
      const statusChange = [
        'approved',
        'unapproved',
        'deprecated',
        'reinstated',
      ].includes(event.change);
      if (statusChange || event.linkingChanged) {
        await this.scheduler.scheduleBackfill({
          termIds: [event.termId],
          reason: `term ${event.key} ${event.change}`,
        });
      }
      if (event.change === 'created' || event.keys?.length) {
        await this.stitch([event.key, ...(event.keys ?? [])]);
      }
      if (event.change !== 'deleted') {
        await this.scheduler.scheduleSuggestions({
          generators: ['link'],
          termIds: [event.termId],
          reason: `term ${event.key} ${event.change}`,
        });
      }
      await this.scheduler.scheduleMapRebuild(`term ${event.change}`);
    });

    glossaryEvents.on('glossary.relation_changed', async () => {
      await this.scheduler.scheduleMapRebuild('relation changed');
    });

    const everything = async (reason: string) => {
      await this.scheduler.scheduleVocabularyRefresh(null, reason);
      await this.scheduler.scheduleBackfill({ all: true, reason });
      await this.stitchAll();
      await this.scheduler.scheduleMapRebuild(reason);
      await this.scheduler.scheduleSuggestions({ reason });
    };
    glossaryEvents.on('semantic.derived_cleared', async (event) => {
      const reason = `${event.dataset} cleaned up`;
      if (event.dataset === 'vocabulary') {
        await this.scheduler.scheduleVocabularyRefresh(null, reason);
      } else if (event.dataset === 'semanticLinks') {
        await this.scheduler.scheduleBackfill({ all: true, reason });
      } else if (event.dataset === 'semanticMap') {
        await this.scheduler.scheduleMapRebuild(reason);
      }
    });

    glossaryEvents.on('glossary.imported', () =>
      everything('glossary imported'),
    );
    glossaryEvents.on('glossary.pack_installed', (event) =>
      everything(`pack ${event.packKey} installed`),
    );

    glossaryEvents.on('semantic.links_updated', async (event) => {
      await this.scheduler.scheduleMapRebuild('links updated');
      const touched = event.terms.reduce((sum, t) => sum + t.added + t.gone, 0);
      if (touched >= 500) {
        await this.scheduler.scheduleSuggestions({
          generators: ['link', 'relation'],
          reason: 'links updated',
        });
      }
    });
  }

  private async stitch(keys: string[]) {
    try {
      const result = await stitchTermRefs(this.prisma, keys.filter(Boolean));
      if (result.assetIds.length) {
        await this.scheduler.scheduleIncrementalForAssets(
          result.assetIds,
          'term references stitched',
        );
      }
    } catch (error) {
      this.logger.warn(`Stitching term references failed: ${String(error)}`);
    }
  }

  private async stitchAll() {
    try {
      const refs = await this.prisma.$queryRaw<Array<{ urn: string }>>`
        SELECT DISTINCT to_id AS urn FROM edges WHERE to_type = ${TERM_REF_NODE}
        UNION SELECT DISTINCT from_id FROM edges WHERE from_type = ${TERM_REF_NODE}`;
      const keys = refs
        .map((row) => keyFromTermUrn(row.urn))
        .filter((key): key is string => Boolean(key));
      if (keys.length) await this.stitch(keys);
    } catch (error) {
      this.logger.warn(`Stitching term references failed: ${String(error)}`);
    }
  }
}
