-- Add encrypted Hugging Face token column to instance_settings.
ALTER TABLE "instance_settings" ADD COLUMN "hf_token_enc" TEXT;
