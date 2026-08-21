-- AlterTable
-- Marks a provider as serving an embeddings endpoint. Defaults to false: the
-- embeddings API is a different surface from chat completions, so an existing
-- provider must be opted in deliberately rather than assumed capable.
ALTER TABLE "ai_provider_config" ADD COLUMN "supports_embedding" BOOLEAN NOT NULL DEFAULT false;
