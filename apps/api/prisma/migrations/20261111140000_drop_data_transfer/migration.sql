-- Namespace export/import is gone: drop its job table, archive chunks and enums.
DROP TABLE IF EXISTS "data_transfer_chunks";
DROP TABLE IF EXISTS "data_transfer_jobs";
DROP TYPE IF EXISTS "DataTransferKind";
DROP TYPE IF EXISTS "DataTransferStatus";
DROP TYPE IF EXISTS "DataTransferConflict";
