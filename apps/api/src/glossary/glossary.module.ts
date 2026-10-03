import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { CustomDetectorsService } from '../custom-detectors.service';
import { CustomDetectorTestsService } from '../custom-detector-tests.service';
import { GlossaryController } from './glossary.controller';
import { GlossaryService } from './glossary.service';
import { GlossaryRelationsService } from './glossary-relations.service';
import { GlossaryImportExportService } from './glossary-import-export.service';
import { BindingsService } from '../semantic/bindings/bindings.service';
import { VocabularyService } from '../semantic/vocabulary/vocabulary.service';
import { SemanticJobsScheduler } from '../semantic/semantic-jobs.scheduler';
import { SemanticLinkerService } from '../semantic/linker/semantic-linker.service';
import { MeaningService } from '../semantic/links/meaning.service';
import { SemanticSuggestionsService } from '../semantic/suggestions/semantic-suggestions.service';
import { GlossaryProposalsService } from '../semantic/suggestions/glossary-proposals.service';
import { SemanticMapService } from '../semantic/map/semantic-map.service';
import { SemanticBoardLayerService } from '../semantic/board/semantic-board-layer.service';
import { GlossaryPacksService } from '../semantic/packs/glossary-packs.service';
import { FindInTextService } from '../semantic/find-in-text/find-in-text.service';
import { SemanticEventsListener } from '../semantic/semantic-events.listener';
import { SemanticWorker } from '../semantic/semantic.worker';
import { SemanticController } from '../semantic/semantic.controller';
import { GlossarySemanticController } from '../semantic/glossary-semantic.controller';
import { CaseLeadsScheduler } from '../cases/case-leads.scheduler';
import { EntitiesController } from '../entities/entities.controller';
import { EntitiesService } from '../entities/entities.service';
import { EntitiesWorker } from '../entities/entities.worker';
import { EntityCandidatesService } from '../entities/entity-candidates.service';
import { EntityMentionsService } from '../entities/entity-mentions.service';
import { EntityResolutionService } from '../entities/entity-resolution.service';
import { EntitySwitchService } from '../entities/entity-switch.service';
import { EntityValuesService } from '../entities/entity-values.service';

/**
 * The glossary and the semantic layer (docs/prd/SL0–SL5), and the entities
 * built on its ENTITY kind (docs/prd/G5-entities.md).
 *
 * One module instance so the stateful parts (the binding cache, the event
 * listeners, the linker, suggestion and map workers) exist once. AppModule,
 * AutopilotModule and CorrelationModule import it rather than re-providing its
 * services.
 */
@Module({
  imports: [EmbeddingModule],
  controllers: [
    GlossaryController,
    GlossarySemanticController,
    SemanticController,
    EntitiesController,
  ],
  providers: [
    PrismaService,
    // Re-provided leaf services "Find in text" creates detectors with, as
    // other modules do (see AutopilotModule).
    AiProviderConfigService,
    MaskedConfigCryptoService,
    CustomDetectorsService,
    CustomDetectorTestsService,
    GlossaryService,
    GlossaryRelationsService,
    GlossaryImportExportService,
    BindingsService,
    VocabularyService,
    SemanticJobsScheduler,
    SemanticLinkerService,
    MeaningService,
    SemanticSuggestionsService,
    GlossaryProposalsService,
    SemanticMapService,
    SemanticBoardLayerService,
    GlossaryPacksService,
    FindInTextService,
    SemanticEventsListener,
    SemanticWorker,
    // Entities (G5). The resolution worker asks cases to refresh their leads.
    CaseLeadsScheduler,
    EntitySwitchService,
    EntityValuesService,
    EntityMentionsService,
    EntityCandidatesService,
    EntityResolutionService,
    EntitiesService,
    EntitiesWorker,
  ],
  exports: [
    GlossaryService,
    GlossaryRelationsService,
    GlossaryImportExportService,
    BindingsService,
    VocabularyService,
    SemanticJobsScheduler,
    SemanticLinkerService,
    MeaningService,
    SemanticSuggestionsService,
    GlossaryProposalsService,
    SemanticMapService,
    SemanticBoardLayerService,
    GlossaryPacksService,
    FindInTextService,
    SemanticWorker,
    EntitySwitchService,
    EntityValuesService,
    EntityMentionsService,
    EntityCandidatesService,
    EntityResolutionService,
    EntitiesService,
    EntitiesWorker,
  ],
})
export class GlossaryModule {}
