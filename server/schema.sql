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
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id,status);
CREATE INDEX IF NOT EXISTS idx_events_created ON task_events(created_at DESC);
