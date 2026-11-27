-- Account profiles (who the content is for, tone, what is forbidden) injected into every creative step,
-- and the script check (Daren + Director) before the expensive production steps.
CREATE TABLE IF NOT EXISTS content_profiles (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  handle text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT '',
  forbidden text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_profiles_one_default ON content_profiles (is_default) WHERE is_default;
