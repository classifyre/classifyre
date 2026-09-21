-- An operator stop is a decision, not a failure (GENESIS field report P8).
--
-- Until now a stopped run was ERROR with errorMessage 'Manually stopped', so
-- the adaptive scheduler had to sniff that string and every dashboard that
-- counts errors counted a stop as a failed scan.
--
-- `ADD VALUE IF NOT EXISTS` runs outside a transaction on Postgres 12+ and is
-- idempotent, so it is safe to replay across every tenant schema.
ALTER TYPE "RunnerStatus" ADD VALUE IF NOT EXISTS 'STOPPED';
