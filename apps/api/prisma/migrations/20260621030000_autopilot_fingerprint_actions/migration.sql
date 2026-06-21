-- AlterEnum: fingerprint/correlation decision actions
ALTER TYPE "AgentDecisionAction" ADD VALUE 'RECOMPUTE_CORRELATION';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'TUNE_CORRELATION';
