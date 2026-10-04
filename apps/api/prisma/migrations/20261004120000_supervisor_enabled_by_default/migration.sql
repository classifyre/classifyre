-- New workspaces ship with the supervisor on: it paces itself, commands the
-- other agents and surfaces their outcomes. Only the column default changes —
-- workspaces that already chose (on or off) keep their stored value.
ALTER TABLE "instance_settings" ALTER COLUMN "supervisor_enabled" SET DEFAULT true;
