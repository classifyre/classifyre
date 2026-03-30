-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('OPENAI_COMPATIBLE', 'CLAUDE', 'GEMINI');

-- CreateTable
CREATE TABLE "ai_provider_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" "AiProviderType" NOT NULL DEFAULT 'CLAUDE',
    "model" TEXT NOT NULL DEFAULT '',
    "api_key_enc" TEXT,
    "base_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_config_pkey" PRIMARY KEY ("id")
);
