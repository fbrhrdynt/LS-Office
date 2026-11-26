# Command Center Addendum — LogiSource AI Office

Status: Approved product direction
Date: 26 Nov 2026
Scope: Extend the existing 3D office into an assisted AI operations workspace.

## 1. Product decision

The Command Center supports two first-class interaction modes:

1. Chat Command: natural-language instructions to one employee, a team, or the workforce.
2. Task Assignment: explicit task creation with assignee, reviewer, priority, deadline, and acceptance criteria.

Both modes create the same canonical Task records. Chat is an input surface, not a separate execution system.

## 2. Operating principles

- Assisted autonomy: agents may research, draft, analyze, and prepare changes; consequential external actions require human approval.
- No simulated work states in production. 3D character status must be derived from persisted task/agent runtime events.
- Every task has an owner, lifecycle, audit trail, and output artifact.
- Employees may delegate only within their reporting scope. Delegation cycles are rejected.
- Agent output is untrusted until reviewed. Never execute arbitrary generated shell commands or code on the application host.
- OpenAI API credentials stay server-side and are never sent to the browser.
- API usage and estimated cost are recorded per run; budgets and rate limits are enforced.

## 3. Personnel and reporting

- Alex — AI Managing Director; operational orchestration and escalation to the human Director.
- Ethan — Creative Director; reports to Alex.
  - Nadia — Research & Creative Strategist; reports to Ethan.
  - Felix — Scriptwriter & Content Writer; reports to Ethan.
  - Maya — Voice & Audio Specialist; reports to Ethan.
  - Olivier — Social Media & Distribution Specialist; reports to Ethan.
- Adrian — Content Performance Analyst; reports to Alex.
- Arvin — Lead Software Engineer; reports to Alex.
  - Nathan — Full-stack Developer; reports to Arvin.
  - Daren — QA Automation & DevOps Engineer; reports to Arvin.

The roster is seeded from the nine-person charter. Alex is a supervisory orchestrator, not an additional employee seat in the nine-person roster.

## 4. Command Center information architecture

### Overview
- Active tasks, queued tasks, tasks awaiting review, blocked tasks.
- Personnel availability and current assignment.
- Recent events and API usage.

### Chat Command
- Conversation thread with Director.
- Target selector: one employee, reporting team, or Alex/orchestrator.
- Composer supports instruction and optional context/attachments in a later phase.
- Before dispatch, show interpreted intent, proposed assignee(s), expected deliverable, and approval requirement.
- Dispatch creates Task records and TaskRun records; chat messages alone do not imply work has started.

### Task Assignment
Fields:
- title (required)
- instruction (required)
- assignee_id (required)
- reviewer_id (optional, defaults from reporting line)
- priority: low | normal | high | urgent
- due_at (optional)
- acceptance_criteria (optional)
- parent_task_id (optional, for delegated subtasks)

### Task detail
- Description and acceptance criteria
- Assignee, reviewer, priority, deadline
- Status timeline and agent activity events
- Deliverables and review decision
- Retry / cancel controls with audit trail

### Review inbox
- Approve, request changes, or reject.
- Approval records reviewer, timestamp, decision, and notes.
- An agent cannot approve its own deliverable.

## 5. Task lifecycle

Draft -> Queued -> Assigned -> In Progress -> Review -> Approved -> Completed

Alternative transitions:
- Assigned/In Progress -> Blocked
- Review -> In Progress (changes requested)
- Draft/Queued/Assigned -> Cancelled
- Failed runs remain visible and can be retried with a new TaskRun.

A task is not Completed merely because an LLM response was received. It must satisfy acceptance criteria and pass its review policy.

## 6. Agent execution workflow

1. Authenticate Director and validate request.
2. Parse the command into a structured intent.
3. Resolve target employee(s) using the fixed personnel registry and reporting graph.
4. Show a dispatch preview when ambiguity, delegation, external action, or elevated cost is detected.
5. Persist the Task and audit event transactionally.
6. Queue a TaskRun.
7. Build a constrained employee prompt from role charter, task context, policy, and allowed tools.
8. Call OpenAI API from the server using environment credentials.
9. Persist run status, token usage, model, latency, output, and errors.
10. If delegation is appropriate, create linked subtasks subject to scope and depth limits.
11. Submit deliverable to reviewer.
12. Publish task/agent events to the 3D office and Command Center.

## 7. Initial database model

### employees
- id TEXT PRIMARY KEY
- key TEXT UNIQUE NOT NULL
- name TEXT NOT NULL
- role TEXT NOT NULL
- department TEXT NOT NULL
- manager_id TEXT NULL REFERENCES employees(id)
- system_prompt TEXT NOT NULL
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### conversations
- id TEXT PRIMARY KEY
- created_by TEXT NOT NULL
- title TEXT
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### messages
- id TEXT PRIMARY KEY
- conversation_id TEXT NOT NULL REFERENCES conversations(id)
- role TEXT NOT NULL
- employee_id TEXT NULL REFERENCES employees(id)
- content TEXT NOT NULL
- metadata_json TEXT NOT NULL DEFAULT '{}'
- created_at TEXT NOT NULL

### tasks
- id TEXT PRIMARY KEY
- parent_task_id TEXT NULL REFERENCES tasks(id)
- title TEXT NOT NULL
- instruction TEXT NOT NULL
- acceptance_criteria TEXT
- assignee_id TEXT NOT NULL REFERENCES employees(id)
- reviewer_id TEXT NULL REFERENCES employees(id)
- priority TEXT NOT NULL
- status TEXT NOT NULL
- due_at TEXT NULL
- created_by TEXT NOT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### task_runs
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- attempt INTEGER NOT NULL
- status TEXT NOT NULL
- model TEXT
- input_tokens INTEGER NOT NULL DEFAULT 0
- output_tokens INTEGER NOT NULL DEFAULT 0
- latency_ms INTEGER
- output_text TEXT
- error_code TEXT
- error_message TEXT
- started_at TEXT
- finished_at TEXT
- created_at TEXT NOT NULL

### task_events
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- actor_type TEXT NOT NULL
- actor_id TEXT
- event_type TEXT NOT NULL
- payload_json TEXT NOT NULL DEFAULT '{}'
- created_at TEXT NOT NULL

### approvals
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- reviewer_id TEXT NOT NULL REFERENCES employees(id)
- decision TEXT NOT NULL
- notes TEXT
- created_at TEXT NOT NULL

### usage_ledger
- id TEXT PRIMARY KEY
- task_run_id TEXT NOT NULL REFERENCES task_runs(id)
- provider TEXT NOT NULL
- model TEXT NOT NULL
- input_tokens INTEGER NOT NULL DEFAULT 0
- output_tokens INTEGER NOT NULL DEFAULT 0
- estimated_cost_usd REAL NOT NULL DEFAULT 0
- created_at TEXT NOT NULL

## 8. API contract (v1)

All endpoints are same-origin under /api/v1. JSON only. Auth required except health check.

- GET /health
- GET /employees
- GET /overview
- GET /conversations
- POST /conversations
- GET /conversations/:id/messages
- POST /conversations/:id/messages
  - body: { content, targetEmployeeId? }
  - response includes parsed dispatch preview; explicit confirmation required before enqueue when flagged.
- GET /tasks?status=&assigneeId=
- POST /tasks
  - body: { title, instruction, assigneeId, reviewerId?, priority?, dueAt?, acceptanceCriteria? }
- GET /tasks/:id
- POST /tasks/:id/dispatch
- POST /tasks/:id/cancel
- POST /tasks/:id/retry
- POST /tasks/:id/approval
  - body: { decision: "approved" | "changes_requested" | "rejected", notes? }
- GET /events?after=
- GET /usage/summary

Use SSE for live event delivery initially; avoid WebSocket complexity until required.

## 9. Security and reliability

- Director authentication; secure, HttpOnly, SameSite cookies; CSRF protection for state-changing requests.
- Rate limiting on chat, task creation, and dispatch.
- Server-side OpenAI key only; redact secrets from logs.
- Validate all request bodies and enforce maximum prompt/output sizes.
- Parameterized SQL and foreign-key constraints.
- Per-run timeout, bounded retries with exponential backoff, and idempotency keys for dispatch.
- Worker concurrency limit and daily/monthly token budget.
- Tool allowlist per employee; no unrestricted shell, filesystem, browser, or external posting in the initial release.
- Human approval for external communications, publishing, purchases, destructive actions, and production deployments.
- Append-only audit events for task transitions and approvals.
- Backups for database and deliverables; health checks and structured logs.

## 10. Runtime and deployment direction

Economical single-VPS deployment, no Docker:
- Existing Vite frontend served by Nginx.
- Node.js API + worker as a separate systemd service.
- SQLite database for initial single-instance deployment; WAL mode, foreign keys, backup policy.
- OpenAI API accessed only by backend.
- SSE for live Command Center and office status.
- Keep API and worker concurrency low; cap output tokens and enforce usage budgets.
- Store runtime data outside the Git checkout (for example /var/lib/ls-office).

SQLite is an initial single-node choice. Move to PostgreSQL if concurrent writers, multi-instance deployment, or reporting needs outgrow it.

## 11. Delivery phases

### Phase 0 — Foundation and contract
- Confirm this addendum, seed the nine employees and reporting hierarchy.
- Define environment variables, database migrations, API contracts, auth boundary, and test strategy.

### Phase 1 — Command Center MVP
- Implement API, SQLite migrations, seeded employees, authenticated Director session.
- Implement chat and task assignment UI.
- Implement task queue, run persistence, review inbox, audit events.
- Add usage ledger and conservative rate/token limits.

### Phase 2 — Live office integration
- Replace simulated personnel status with backend event-derived states.
- Publish working, reviewing, blocked, available, and offline states to 3D scene.
- Show current task at employee detail.

### Phase 3 — Delegation and tools
- Add bounded subtasks and supervisor review.
- Add narrowly scoped tools (research/search, document generation, repository operations) behind permissions and approval gates.

### Phase 4 — Operations hardening
- Backups/restore drills, observability, budgets, alerting, concurrency and load tests.

## 12. Acceptance criteria

- A Director can create a task from Chat Command or Task Assignment.
- A task and its run survive page refresh and service restart.
- Only the assigned agent's server-side runtime can execute the task.
- Real execution status is event-derived; no demo schedule is presented as real work.
- Output is persisted and visible in task detail.
- Review decision is auditable and self-approval is rejected.
- API key never appears in browser assets, responses, or logs.
- Token usage, model, latency, and errors are visible.
- Build, tests, migration tests, API tests, and manual mobile checks pass before production deploy.
