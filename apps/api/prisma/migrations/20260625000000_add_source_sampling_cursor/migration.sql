-- Add an opaque, source-defined sampling cursor to the sources table.
-- AUTOMATIC sampling persists this cursor at the end of each run and the API
-- injects it into the next run so extraction continues incrementally. The API
-- never interprets its contents.

ALTER TABLE "sources" ADD COLUMN "sampling_cursor" JSONB;
