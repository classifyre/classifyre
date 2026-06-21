-- AlterEnum: richer memory categories
ALTER TYPE "AgentMemoryKind" ADD VALUE 'ENTITY_MAP';
ALTER TYPE "AgentMemoryKind" ADD VALUE 'SOURCE_PROFILE';
ALTER TYPE "AgentMemoryKind" ADD VALUE 'DETECTOR_INSIGHT';
ALTER TYPE "AgentMemoryKind" ADD VALUE 'OPERATOR_DIRECTIVE';

-- CreateTable: living system brief (singleton, id = 1)
CREATE TABLE "agent_system_brief" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL DEFAULT '',
    "facts" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_system_brief_pkey" PRIMARY KEY ("id")
);
