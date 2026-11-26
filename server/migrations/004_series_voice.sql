-- One narrator voice per series (ElevenLabs voice id), fixed after the first rendered part.
ALTER TABLE series ADD COLUMN IF NOT EXISTS voice_id text;
ALTER TABLE series ADD COLUMN IF NOT EXISTS voice_name text;
