# LogiSource AI Office (LS-Office)

Dokumentasi utama proyek. README ini sengaja dibagi menjadi dua bagian: informasi aplikasi untuk pengguna/stakeholder dan catatan teknis untuk developer/AI assistant yang melanjutkan pekerjaan.

---

# 1. App Info

## Overview

**LogiSource AI Office** adalah platform kantor internal berbasis AI untuk mengelola personnel AI, penugasan pekerjaan, workflow lintas divisi, review Director, dan produksi konten.

- **Product:** LogiSource AI Office
- **Repository:** https://github.com/fbrhrdynt/LS-Office
- **Production URL:** https://office.febro.id
- **Deployment target:** Ubuntu VPS, Node.js, PostgreSQL, systemd, Nginx
- **Operating mode:** Internal, assisted autonomy
- **Product version:** 0.3.0 (development)
- **Primary language:** Indonesian
- **AI supervisor:** Alex — AI Managing Director

## Organization

Alex bertindak sebagai AI Managing Director dan reviewer/Director. Sembilan personnel operasional berada di bawah struktur berikut.

| Personnel | Department | Role | Reports to |
|---|---|---|---|
| Nadia | Creative | Research & Creative Strategist | Ethan |
| Felix | Creative | Scriptwriter & Content Writer | Ethan |
| Ethan | Creative | Creative Director & Storyboard Artist | Alex |
| Maya | Creative | Voice & Audio Specialist | Ethan |
| Olivier | Marketing | Social Media & Distribution Specialist | Ethan |
| Adrian | Analytics | Content Performance Analyst | Alex |
| Arvin | Web Development | Lead Software Engineer | Alex |
| Nathan | Web Development | Full-stack Developer | Arvin |
| Daren | Web Development | QA Automation & DevOps Engineer | Arvin |

Alex adalah supervisor virtual, bukan salah satu dari sembilan employee seats yang ditampilkan sebagai personnel operasional.

## Current capabilities

- Director login dengan server-side session dan secure HttpOnly cookie.
- Employee directory dan struktur reporting.
- Command Center untuk membuat task, memilih assignee, memantau antrean, dan melihat aktivitas.
- Task execution melalui backend worker dan OpenAI API.
- Task review oleh Director: approve, request changes, atau reject.
- Persistensi task, task runs, events, dan workflow steps di PostgreSQL.
- Animated drama video pipeline: riset, script, storyboard, voice/audio direction, image generation, TTS, FFmpeg MP4 render, dan technical QA.
- Video output motion-comic vertikal 720x1280 dan authenticated MP4 download.
- Approval gate setelah riset Nadia dan sebelum distribusi final Olivier.
- Publication queue untuk Instagram, TikTok, YouTube, dan Facebook.
- Fondasi koneksi akun sosial berbasis OAuth dan penyimpanan token terenkripsi sudah terintegrasi; live provider OAuth tetap membutuhkan kredensial dan verifikasi.

## Workflow produksi video

1. **Nadia** — riset dan validasi ide. Hasil wajib disetujui Director sebelum produksi berlanjut.
2. **Felix** — penulisan naskah.
3. **Ethan** — creative direction dan storyboard.
4. **Maya** — voice dan audio direction.
5. **Production Engine** — generate visual, voiceover, dan render MP4.
6. **Daren** — QA teknis file video menggunakan ffprobe.
7. **Olivier** — caption, hashtag, rekomendasi platform, dan persiapan distribusi. Hasil menunggu final approval Director.

Setelah final approval, sistem membuat publication jobs untuk empat platform. **Queue bukan berarti konten sudah dipublikasikan.** Live publishing masih memerlukan OAuth/provider setup, upload implementation, dan verifikasi respons platform.

## Known limitations

- Video saat ini adalah motion-comic dengan gerakan kamera pada scene image, bukan animasi 3D karakter full-rig atau frame-by-frame.
- Konsistensi karakter antarscene bersifat best-effort.
- Publication queue belum melakukan upload/publishing otomatis.
- OAuth provider flow sedang dikembangkan dan tetap membutuhkan konfigurasi serta pengujian menggunakan aplikasi developer resmi masing-masing platform.
- TikTok public posting dapat memerlukan audit/approval platform.
- Penggunaan image dan speech generation menambah biaya API; batasi workload dan pantau pemakaian.

---

# 2. Developer Guide

## Project status — updated 2026-11-26

**Current integration state**

| Area | Status | Notes |
|---|---|---|
| PR #1 — Director sessions + video pipeline | Merged to `main` | Merge commit `efb2feb197fff77f3006c1cf91be921c289b1df7` |
| PR #2 — approval gates + publication queue | Closed / superseded | Changes integrated into `main`; original PR retained as historical record |
| PR #3 — social OAuth foundation | Closed / superseded | OAuth foundation reconstructed and merged through PR #6 |
| PR #6 — social account connection foundation | Merged to `main` | OAuth foundation, encrypted token storage, state/session-bound callback flow and account listing |\n| PR #7 — Command Center approval actions | Merged to `main` | Fixes regular task review API handling and adds UI processing/feedback; see latest merge commit |\n| VPS deployment | Not performed for the latest main changes | Production remains on the previously deployed revision until a deploy is executed and verified on the VPS |
| README | Updated on `main` | Two-section app/developer handover includes OAuth foundation and current integration status |

Do not assume the latest `main` commit is deployed. Do not mark social accounts connected or posts published without live provider verification.

## Architecture

```text
Browser
  |
  | HTTPS
  v
Nginx (office.febro.id)
  |
  | /api/*
  v
Node.js API :3215 (127.0.0.1)
  |                     |
  | PostgreSQL          | OpenAI API
  v                     v
ls_office DB        Responses / Images / Audio
  ^
  |
Node.js Worker
(systemd service)
  |
  +-- workflow orchestration
  +-- approval checkpoints
  +-- FFmpeg rendering
  +-- ffprobe QA
  +-- publication queue
```

The browser must never receive server secrets. API and worker use the protected environment file at `/etc/ls-office/api.env`. Do not commit real credentials, tokens, OAuth secrets, or production environment files.

## Repository structure

| Path | Responsibility |
|---|---|
| `src/` | React + TypeScript frontend and Command Center |
| `src/CommandCenter.tsx` | Director login, task composer, task queue, workflow review and publication queue UI |
| `server/index.mjs` | HTTP API, authentication/session, task lifecycle, approvals and API routes |
| `server/worker.mjs` | Background task claiming and sequential workflow execution |
| `server/workflows.mjs` | Workflow definitions, employee assignment and approval requirements |
| `server/employees.mjs` | Employee seed data, role definitions and system prompts |
| `server/schema.sql` | PostgreSQL schema and additive migrations |
| `server/video.mjs` | AI-assisted video generation and FFmpeg rendering |
| `server/social-oauth.mjs` | Social OAuth URL, callback exchange and token encryption (PR #6) |
| `server/README.md` | API, worker, environment and operational notes |
| `scripts/test.mjs` | Existing application tests |
| `scripts/test-workflow.mjs` | Workflow routing and approval-gate tests |
| `scripts/test-social-oauth.mjs` | Social OAuth security tests (PR #6) |
| `.github/workflows/ci.yml` | GitHub Actions validation pipeline |

## Runtime and infrastructure

Production environment previously recorded:

- Ubuntu 24.04.4 LTS
- Node.js 22.23.5
- PostgreSQL 16.15
- FFmpeg / ffprobe installed
- Nginx reverse proxy with HTTPS
- Production directory: `/opt/ls-office`
- Domain: `office.febro.id`
- PostgreSQL database: `ls_office`
- API systemd unit: `ls-office-api`
- Worker systemd unit: `ls-office-worker`
- API bind: `127.0.0.1:3215`
- Environment file: `/etc/ls-office/api.env`
- Video storage: `/opt/ls-office/storage/videos`

Infrastructure values above are handover context, not proof that the latest GitHub branch is running in production. Confirm service state and deployed commit on the VPS before changing production.

## Local development

Requirements: Node.js 22 and PostgreSQL for full backend workflows.

```bash
npm install
npm run dev
```

Build and validation:

```bash
node --check server/index.mjs
node --check server/worker.mjs
node --check server/video.mjs
node --check server/workflows.mjs
npm run test:workflow
npm test
npm run build
```

Run the API and worker only after configuring a dedicated PostgreSQL database and protected environment variables. Never point local development at production by default.

## Authentication and security

- Director login exchanges the bootstrap credential for a random server-side session.
- Session token is stored hashed in PostgreSQL; browser receives Secure, HttpOnly cookie.
- Logout revokes the session.
- Keep `LS_OFFICE_ADMIN_TOKEN`, `OPENAI_API_KEY`, OAuth client secrets, encryption keys and database credentials server-side.
- OAuth state must be random, single-use, short-lived and bound to the Director session.
- Social access/refresh tokens must remain encrypted at rest using AES-256-GCM.
- Do not log raw tokens, authorization codes, secrets, or full environment values.
- Apply rate limits and operational monitoring before expanding beyond the trusted internal audience.

## Database notes

Core tables:

- `employees`
- `tasks`
- `task_runs`
- `task_events`
- `director_sessions`
- `workflow_steps`
- `publication_jobs`
- `social_accounts` (PR #6)
- `social_oauth_states` (PR #6)

Schema is applied by the API startup path. Review schema changes for backward compatibility and safe additive migrations. Back up PostgreSQL before production migration or deployment.

## Environment configuration

Template: `server/.env.example`. Production file: `/etc/ls-office/api.env`.

Social OAuth configuration (PR #6) uses server-only variables:

- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
- TikTok: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
- Google/YouTube: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- Token encryption: `SOCIAL_TOKEN_ENCRYPTION_KEY` (base64-encoded 32-byte key)

Add new keys to the example template with safe placeholders and document their purpose. Never add actual values.

## Integration and deployment rules

1. Work on a feature branch; do not push unfinished work directly to `main`.
2. Rebase/reconstruct dependent PRs on current `main`; do not force-push or discard user work to resolve conflicts.
3. Run backend syntax checks, workflow tests, application tests and production build.
4. Review the exact diff and CI result before merge.
5. Update this README in the same PR whenever behavior, architecture, schema, configuration, tests, limitations, or deployment changes.
6. Before deployment, verify clean working tree and expected commit on VPS; preserve unknown/untracked local files.
7. Back up PostgreSQL, install dependencies reproducibly, build, apply migrations, restart API/worker, and verify health/logs.
8. Never claim deployment, OAuth connection, video generation, or social publication succeeded without runtime evidence.

## Handover checklist for the next developer / AI assistant

- Read both README sections before making changes.
- Check `main`, open PRs, latest CI runs, and current production commit; this README is a handover snapshot and can become stale.
- Inspect actual source and configuration before editing. Do not infer missing code from this document alone.
- Preserve the nine-personnel organization and Alex's Director role unless product requirements explicitly change.
- Update this README's **Project status**, **Repository structure**, **Known limitations**, and relevant technical sections in the same change.
- Record commit/PR identifiers and test outcomes; distinguish implemented, tested, configured, and deployed states.
