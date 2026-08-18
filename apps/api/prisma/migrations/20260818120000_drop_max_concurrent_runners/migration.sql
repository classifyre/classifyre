-- Scan concurrency is a property of the machine, not of a workspace: two scans
-- contend for the same cores whichever workspace started them. The value was
-- already read from MAX_CONCURRENT_RUNNERS whenever that variable was set,
-- which the Helm chart always does and the desktop app now does too — so this
-- column had no effect on any real deployment and only existed to back a
-- control in the web UI that could not actually change anything.
--
-- The environment variable remains the single way to set it.
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "max_concurrent_runners";
