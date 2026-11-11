-- Sign-in is always on, so who may query a table is decided by grants
-- (data.query on the workspace, a source or a table). The per-workspace
-- on/off switch that stood in for them without sign-in is gone.
ALTER TABLE "data_query_settings" DROP COLUMN IF EXISTS "enabled";
