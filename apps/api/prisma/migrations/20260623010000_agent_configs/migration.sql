-- CreateTable: per-agent harness configuration (goal / iterations / tool overrides)
CREATE TABLE "agent_configs" (
    "kind" "AgentKind" NOT NULL,
    "goal" TEXT,
    "max_iterations" INTEGER,
    "tool_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tools_override" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_configs_pkey" PRIMARY KEY ("kind")
);
