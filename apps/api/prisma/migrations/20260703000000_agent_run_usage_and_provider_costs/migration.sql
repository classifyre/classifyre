-- Token consumption + estimated cost per autopilot run
ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "output_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cost_usd" DECIMAL(14,6);

-- Optional per-1M-token pricing on AI provider credentials (USD)
ALTER TABLE "ai_provider_config"
  ADD COLUMN IF NOT EXISTS "input_cost_per_mtok" DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS "output_cost_per_mtok" DECIMAL(10,4);
