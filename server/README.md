# LogiSource AI Office API + Worker

- PostgreSQL-backed employee registry, task queue, task runs, events and approvals.
- API binds to 127.0.0.1:3215. Nginx proxies /api/ from the existing HTTPS vhost.
- Nine employee seats are seeded, plus Alex as virtual supervisor (not in the employee picker).
- Worker claims queued work with PostgreSQL row locks and calls OpenAI Responses API server-side.
- Successful runs enter review. The Director must approve, request changes or reject.
- Worker has no shell, filesystem or publishing tools.

## Environment

Copy server/.env.example to /etc/ls-office/api.env and set DATABASE_URL, a long random LS_OFFICE_ADMIN_TOKEN, and OPENAI_API_KEY. Never expose these as Vite variables. The Director token is held in page memory only.

The initial bearer-token gate is suitable only for a restricted internal deployment. Before broad internet exposure, add proper user sessions, CSRF protection, token rotation, rate limiting and stronger reviewer identity.

## Install

Create a dedicated PostgreSQL role/database named ls_office; never reuse another application's database. Install Node dependencies, configure the environment file, install both systemd units, and add nginx-location.conf inside the existing HTTPS server block for office.febro.id. Run nginx -t before reloading.

Verify /api/health, authenticate in Command Center, create a test task and review the output. The API migrates schema and seeds employees at startup. Do not start the worker until the database, token and provider key are configured.


## Director sessions

- POST /api/auth/login with the existing Director credential creates a 14-day opaque server-side session.
- Session token is stored only as a SHA-256 hash in PostgreSQL and delivered in a Secure, HttpOnly, SameSite=Strict cookie.
- GET /api/auth/session validates the cookie; POST /api/auth/logout revokes it.
- The original admin token remains server-side as the bootstrap login credential. Do not expose it to Vite or browser storage.
- Set SESSION_DAYS to 1-30 days. Use HTTPS; the session cookie is Secure-only.

## Animated drama video pipeline

- Create a task with taskType=animated_video. The worker writes a short Indonesian animated motion-comic: story/script via Responses API, one generated cinematic image per scene via Images API, voiceover via Audio Speech API, and a vertical MP4 rendered by FFmpeg.
- Default models: OPENAI_IMAGE_MODEL=gpt-image-1 and OPENAI_TTS_MODEL=tts-1. Override through the protected environment file if model availability differs for the account.
- Install FFmpeg on the VPS using apt-get install ffmpeg. The worker writes MP4 files under /opt/ls-office/storage/videos.
- The Director can download the rendered MP4 from the authenticated task detail view.
- Video tasks enter review only after an MP4 has rendered. Approval rejects completion if no artifact path exists.
- This pipeline creates a motion-comic with animated camera movement over generated frames, not full 3D character rigging or frame-by-frame generative character animation. Each scene is a generated image, so exact character consistency is best-effort.
- Image and speech generation incur additional OpenAI API usage. Limit video tasks and monitor usage before enabling for broad internal use.
