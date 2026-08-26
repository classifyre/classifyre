-- AlterTable
-- Discounted per-1M-token price for cached input tokens. Null = unknown;
-- cached tokens are then costed at the full input rate (see agent-audit.service.ts).
ALTER TABLE "ai_provider_config" ADD COLUMN "cached_input_cost_per_mtok" DECIMAL(10,4);

-- AlterTable
-- Subset of input_tokens the provider served from its prompt cache.
ALTER TABLE "agent_runs" ADD COLUMN "cached_input_tokens" INTEGER NOT NULL DEFAULT 0;
