-- AlterTable
-- Shape of the embedding model this provider serves. Null on providers that do
-- not serve embeddings, and on embedding providers saved before this column
-- existed — the embedding configuration falls back to its own value there.
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_dimensions" INTEGER;
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_pooling" TEXT;
