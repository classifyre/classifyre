-- AlterTable
-- Text put in front of every input before it is embedded, for models trained
-- with task prompts (EmbeddingGemma, E5, Nomic, Qwen3 Embedding): one for what
-- is stored, one for what is asked. Null sends the text as it is, which is
-- what every provider saved before this column existed keeps doing.
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_document_prefix" TEXT;
ALTER TABLE "ai_provider_config" ADD COLUMN "embedding_query_prefix" TEXT;
