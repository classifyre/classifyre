-- Source augmentation: which notebook an execution ran, and the mode that
-- previews it.
--
-- `scope` names the notebook: the CUSTOM source's own connector notebook, or
-- the per-asset augmentation notebook any source type may carry. Existing rows
-- are connector executions, hence the default. `preview_augment` runs the
-- augmentation notebook's setup()/augment()/finalize() over a sample of the
-- real connector's assets.
--
-- Written by hand and never edited afterwards: `migrate deploy` skips applied
-- migrations without erroring on a checksum mismatch, so an in-place edit
-- drifts every tenant schema until a runtime P2022.
CREATE TYPE "NotebookScope" AS ENUM ('CONNECTOR', 'AUGMENTATION');

ALTER TYPE "NotebookExecutionMode" ADD VALUE IF NOT EXISTS 'PREVIEW_AUGMENT';

ALTER TABLE "notebook_executions"
  ADD COLUMN IF NOT EXISTS "scope" "NotebookScope" NOT NULL DEFAULT 'CONNECTOR';
