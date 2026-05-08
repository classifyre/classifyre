-- Create table for storing per-detector labeled training examples.

CREATE TABLE IF NOT EXISTS "custom_detector_training_examples" (
    "id"                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "custom_detector_id"   TEXT        NOT NULL,
    "label"                TEXT        NOT NULL,
    "text"                 TEXT        NOT NULL,
    "value"                TEXT,
    "accepted"             BOOLEAN     NOT NULL DEFAULT TRUE,
    "source"               TEXT,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "custom_detector_training_examples_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "custom_detector_training_examples_custom_detector_id_fkey"
        FOREIGN KEY ("custom_detector_id")
        REFERENCES "custom_detectors"("id")
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "custom_detector_training_examples_custom_detector_id_label_idx"
    ON "custom_detector_training_examples"("custom_detector_id", "label");
