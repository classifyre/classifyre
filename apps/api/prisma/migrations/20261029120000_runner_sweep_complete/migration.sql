-- Whether a wrapping AUTOMATIC sweep had covered all its ground once when the
-- run finished. The adaptive scheduler reads it so a sweep that is merely going
-- round again is not mistaken for one still reaching new ground.
ALTER TABLE "runners" ADD COLUMN IF NOT EXISTS "sweep_complete" BOOLEAN;
