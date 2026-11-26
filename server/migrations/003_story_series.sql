-- Story series: a multi-part drama with a shared story bible and character sheet; each part is its own task.
CREATE TABLE IF NOT EXISTS series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 origin_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 title text NOT NULL,
 logline text NOT NULL DEFAULT '',
 plan jsonb NOT NULL DEFAULT '{}'::jsonb,
 design jsonb NOT NULL DEFAULT '{}'::jsonb,
 total_parts integer NOT NULL DEFAULT 5 CHECK (total_parts BETWEEN 1 AND 30),
 character_sheet text,
 platforms text[] NOT NULL DEFAULT ARRAY[]::text[],
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','finished')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES series(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS part_no integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_series_part ON tasks(series_id, part_no) WHERE series_id IS NOT NULL AND status NOT IN ('cancelled','rejected');
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN ('text','animated_video','web_build','web_update','story_series','story_episode'));
