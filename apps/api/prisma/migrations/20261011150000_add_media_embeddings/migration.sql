-- Embedding pictures and sound as what they are, next to the text read out of
-- them.

-- AlterTable
-- What the workspace wants embedded besides text. Null inherits the deployment
-- default (EMBEDDING_IMAGES / EMBEDDING_AUDIO); either only has an effect on a
-- model that can embed that kind of content.
ALTER TABLE "embedding_settings" ADD COLUMN "embed_images" BOOLEAN;
ALTER TABLE "embedding_settings" ADD COLUMN "embed_audio" BOOLEAN;

-- AlterTable
-- What a provider's embedding model takes besides text, and the request shape
-- its endpoint wants media in. Every provider saved before this is text-only,
-- which the defaults keep it.
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_modalities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_media_format" TEXT;

-- AlterTable
-- A chunk is a passage of text or a prepared media item. Existing rows are
-- text; adding a column with a constant default does not rewrite the table.
ALTER TABLE "asset_chunks" ADD COLUMN "modality" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "asset_chunks" ADD COLUMN "mime_type" TEXT;
ALTER TABLE "asset_chunks" ADD COLUMN "data" BYTEA;

-- CreateIndex
-- Media is a small share of the chunks and is looked up on its own (a search
-- that has to give pictures a place, the count on the settings page), so the
-- index holds only those rows.
CREATE INDEX "asset_chunks_media_idx" ON "asset_chunks"("modality", "content_hash") WHERE "modality" <> 'text';
