-- Optional human-readable description for a source, set on create/edit and
-- shown in the source overview and the sources table. Sibling to `name`;
-- not part of the ingestion `config` JSON.

-- AlterTable
ALTER TABLE "sources" ADD COLUMN "description" TEXT;
