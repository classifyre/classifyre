-- Media processing is selected from the detected MIME type. Remove the old
-- per-source opt-out fields so persisted configs conform to the new schema.
UPDATE "sources"
SET "config" = "config"
    #- '{sampling,enable_ocr}'
    #- '{sampling,enable_transcription}'
    #- '{optional,sampling,enable_ocr}'
    #- '{optional,sampling,enable_transcription}'
    #- '{optional,transcript,skip_transcript}'
WHERE "config" #> '{sampling,enable_ocr}' IS NOT NULL
   OR "config" #> '{sampling,enable_transcription}' IS NOT NULL
   OR "config" #> '{optional,sampling,enable_ocr}' IS NOT NULL
   OR "config" #> '{optional,sampling,enable_transcription}' IS NOT NULL
   OR "config" #> '{optional,transcript,skip_transcript}' IS NOT NULL;

UPDATE "sources"
SET "config" = "config" #- '{optional,sampling}'
WHERE "config" #> '{optional,sampling}' = '{}'::jsonb;

UPDATE "sources"
SET "config" = "config" #- '{optional,transcript}'
WHERE "config" #> '{optional,transcript}' = '{}'::jsonb;

UPDATE "sources"
SET "config" = "config" - 'optional'
WHERE "config" -> 'optional' = '{}'::jsonb;
