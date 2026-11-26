# LSAI Office backend

Node.js tanpa framework + PostgreSQL. Lihat `docs/OPERATIONS.md` untuk arsitektur, service, env, dan deploy.

| File | Isi |
|---|---|
| `index.mjs` | API HTTP (auth Director, task, approval, chat, sosial, proyek, Telegram link, streaming video) |
| `worker.mjs` | tahap AI personnel, QA video, balasan chat |
| `render-worker.mjs`, `video/produce.mjs` | produksi video: gambar, TTS per adegan, timing kata, render Remotion |
| `publisher.mjs`, `lib/platforms.mjs` | posting terjadwal TikTok / Instagram / Facebook / YouTube |
| `telegram.mjs` | bot Telegram (long polling) |
| `devagent.mjs` | tim Web Dev: Claude Code di worktree terisolasi, QA, preview, rilis |
| `workflows.mjs` | definisi alur Video / Website baru / Update website + skema output terstruktur |
| `lib/engine.mjs` | mesin workflow: buat task, klaim, gerbang approval, revisi, retry, cancel, status kantor |
| `lib/ai.mjs` | OpenAI (Responses, Images, TTS, transkripsi) + pencatatan biaya |
| `migrations/` | migrasi bernomor, dijalankan sekali (advisory lock) |
