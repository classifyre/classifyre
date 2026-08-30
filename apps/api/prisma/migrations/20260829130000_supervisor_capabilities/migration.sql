-- Which capability groups the operator has switched off for the supervisor.
--
-- Its own column rather than a reuse of agent_configs.tool_names: that column
-- is the RESIDENT toolset (what the agent's prompt describes) and means the
-- same thing for every agent, while what the supervisor may CALL is a separate,
-- much longer list. Storing the second in the first would put every schema back
-- into the prompt the split exists to keep small.
--
-- An exception list, not an allow list, so a capability group added in a later
-- release arrives switched on for an instance that never expressed an opinion
-- about it.
ALTER TABLE "supervisor_state"
  ADD COLUMN IF NOT EXISTS "disabled_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
