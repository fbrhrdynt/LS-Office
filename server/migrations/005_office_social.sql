-- Office social life: group conversations between employees (grounded on real work events) and the Director.
CREATE TABLE IF NOT EXISTS conversations (
 id bigserial PRIMARY KEY,
 kind text NOT NULL DEFAULT 'kerja' CHECK (kind IN ('kerja','santai','director')),
 topic text NOT NULL,
 place text NOT NULL DEFAULT 'ngobrol',
 participants text[] NOT NULL DEFAULT ARRAY[]::text[],
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_time ON conversations(started_at DESC);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id bigint REFERENCES conversations(id) ON DELETE SET NULL;
-- Work events worth discussing in the group (a finished step, a Director decision).
CREATE TABLE IF NOT EXISTS social_queue (
 id bigserial PRIMARY KEY,
 kind text NOT NULL,
 task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 done_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_social_queue_open ON social_queue(created_at) WHERE done_at IS NULL;
