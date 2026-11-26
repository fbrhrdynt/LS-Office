CREATE TABLE IF NOT EXISTS employees (
 id text PRIMARY KEY, key text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL,
 department text NOT NULL, manager_key text, system_prompt text NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, instruction text NOT NULL,
 acceptance_criteria text, assignee_id text NOT NULL REFERENCES employees(id),
 reviewer_id text REFERENCES employees(id), priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('draft','queued','assigned','in_progress','review','approved','completed','blocked','changes_requested','rejected','cancelled','failed')),
 created_by text NOT NULL DEFAULT 'director', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'text';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS artifact_path text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS artifact_mime text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS artifact_name text;
CREATE TABLE IF NOT EXISTS task_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 attempt integer NOT NULL, status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
 model text, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
 output_text text, error_message text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(task_id,attempt)
);
CREATE TABLE IF NOT EXISTS task_events (
 id bigserial PRIMARY KEY, task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
 event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS director_sessions (
 token_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id,status);
CREATE INDEX IF NOT EXISTS idx_events_created ON task_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_director_sessions_expiry ON director_sessions(expires_at);

CREATE TABLE IF NOT EXISTS workflow_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 step_order integer NOT NULL,
 step_key text NOT NULL,
 assignee_id text REFERENCES employees(id),
 title text NOT NULL,
 instruction text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
 output_text text,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,step_order),
 UNIQUE(task_id,step_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_ready ON workflow_steps(status,task_id,step_order);


-- Director approval gates and per-platform publication queue.
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_status_check;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_status_check
 CHECK(status IN ('pending','running','awaiting_approval','completed','failed','skipped'));

CREATE TABLE IF NOT EXISTS publication_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK(platform IN ('instagram','tiktok','youtube','facebook')),
 status text NOT NULL DEFAULT 'awaiting_connection'
   CHECK(status IN ('awaiting_connection','queued','publishing','published','failed')),
 caption text,
 external_post_id text,
 post_url text,
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 UNIQUE(task_id,platform)
);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_status ON publication_jobs(status,created_at);


-- Social account vault foundation. Tokens are stored encrypted by the application layer.
CREATE TABLE IF NOT EXISTS social_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 platform text NOT NULL CHECK(platform IN ('instagram','facebook','tiktok','youtube')),
 external_account_id text NOT NULL,
 account_name text NOT NULL,
 access_token_ciphertext text NOT NULL,
 refresh_token_ciphertext text,
 token_expires_at timestamptz,
 scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
 status text NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','expired','revoked','error')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 connected_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(platform,external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform_status ON social_accounts(platform,status);

-- One-time OAuth state, bound to an authenticated Director session.
CREATE TABLE IF NOT EXISTS social_oauth_states (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 state_hash text UNIQUE NOT NULL,
 platform text NOT NULL CHECK(platform IN ('instagram','facebook','tiktok','youtube')),
 session_hash text NOT NULL REFERENCES director_sessions(token_hash) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_oauth_states_expiry ON social_oauth_states(expires_at);

-- (moved from index.mjs) OAuth state table already created above.
