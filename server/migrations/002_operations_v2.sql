-- Operations v2: workflow revisions, cost ledger, notifications, chat, scheduled publishing, web dev projects.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_notes text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN ('text','animated_video','web_build','web_update'));

ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS revision_notes text;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS output_json jsonb;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS decision jsonb;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS executor text NOT NULL DEFAULT 'agent';
ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_executor_check;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_executor_check CHECK(executor IN ('agent','render','qa','devagent'));
UPDATE workflow_steps SET executor='render' WHERE step_key='render_video' AND executor='agent';
UPDATE workflow_steps SET executor='qa' WHERE step_key='qa_video' AND executor='agent';

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS step_id uuid REFERENCES workflow_steps(id) ON DELETE SET NULL;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS cost_usd numeric(12,5) NOT NULL DEFAULT 0;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS latency_ms integer;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS executor text;
ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_status_check;
ALTER TABLE task_runs ADD CONSTRAINT task_runs_status_check CHECK(status IN ('running','succeeded','failed','interrupted','cancelled'));
CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at);

-- Every paid call is recorded with an estimated cost (estimates; real billing is on the provider dashboard).
CREATE TABLE IF NOT EXISTS usage_ledger (
 id bigserial PRIMARY KEY,
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
 step_key text,
 kind text NOT NULL,
 model text,
 units jsonb NOT NULL DEFAULT '{}'::jsonb,
 cost_usd numeric(12,5) NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_created ON usage_ledger(created_at);

-- Things that need the Director: approvals, failures, questions. Mirrored to Telegram when configured.
CREATE TABLE IF NOT EXISTS notifications (
 id bigserial PRIMARY KEY,
 task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
 employee_id text REFERENCES employees(id),
 kind text NOT NULL,
 title text NOT NULL,
 body text NOT NULL DEFAULT '',
 action jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 telegram_sent_at timestamptz,
 telegram_message_id bigint
);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_telegram ON notifications(telegram_sent_at) WHERE telegram_sent_at IS NULL;

-- Director <-> personnel chat (web and Telegram share one history).
CREATE TABLE IF NOT EXISTS messages (
 id bigserial PRIMARY KEY,
 thread text NOT NULL,
 sender text NOT NULL,
 body text NOT NULL,
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 channel text NOT NULL DEFAULT 'web' CHECK(channel IN ('web','telegram','system')),
 status text NOT NULL DEFAULT 'done' CHECK(status IN ('pending','done','failed')),
 meta jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pending ON messages(status, created_at) WHERE status='pending';

-- Scheduled, per-platform publishing.
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES social_accounts(id) ON DELETE SET NULL;
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE publication_jobs ADD COLUMN IF NOT EXISTS provider_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE publication_jobs DROP CONSTRAINT IF EXISTS publication_jobs_status_check;
ALTER TABLE publication_jobs ADD CONSTRAINT publication_jobs_status_check
 CHECK(status IN ('awaiting_connection','scheduled','queued','publishing','processing','published','failed','cancelled'));
CREATE INDEX IF NOT EXISTS idx_publication_jobs_due ON publication_jobs(status, scheduled_at);

-- Key/value settings managed from the app (e.g. linked Telegram chat).
CREATE TABLE IF NOT EXISTS app_settings (
 key text PRIMARY KEY,
 value jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- Web Dev: projects the dev agent may work on. Commands are written by the Director, never by an agent.
CREATE TABLE IF NOT EXISTS dev_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
 name text NOT NULL,
 repo_url text,
 default_branch text NOT NULL DEFAULT 'main',
 install_cmd text,
 build_cmd text,
 test_cmd text,
 preview_dir text,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_project_fk;
ALTER TABLE tasks ADD CONSTRAINT tasks_project_fk FOREIGN KEY(project_id) REFERENCES dev_projects(id) ON DELETE SET NULL;
