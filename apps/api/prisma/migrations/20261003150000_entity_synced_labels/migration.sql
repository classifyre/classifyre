-- G5 · The name labels alias values were last generated under. A run that
-- brings a name label not listed here regenerates them, so a detector added
-- after the entities links exactly like the ones that were there first.
ALTER TABLE "entity_config"
  ADD COLUMN "synced_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
