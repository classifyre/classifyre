-- AlterEnum: new harness/tool decision actions
ALTER TYPE "AgentDecisionAction" ADD VALUE 'TOOL_CALL';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'TUNE_SOURCE';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'CREATE_DETECTOR';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'TRAIN_DETECTOR';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'TRIGGER_SCAN';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'UPDATE_SYSTEM_BRIEF';
