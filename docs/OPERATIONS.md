# LSAI Office · Operasional

## Arsitektur

```
Browser / Telegram ─▶ nginx (office.febro.id)
   /            → /opt/ls-office/dist (React + Three.js, kantor 3D + Command Center)
   /api/        → ls-office-api        127.0.0.1:3215  (Node, PostgreSQL)
   /preview/    → /var/lib/ls-office-dev/previews   (khusus Director, auth_request)
   /sites/      → /var/lib/ls-office-dev/sites      (website hasil tim Web Dev)

PostgreSQL ls_office ◀─ ls-office-worker     tahap AI (OpenAI), QA video, balasan chat
                     ◀─ ls-office-render     gambar + suara + caption → Remotion → MP4
                     ◀─ ls-office-publisher  posting terjadwal TikTok/IG/FB/YouTube
                     ◀─ ls-office-telegram   notifikasi, approval, chat via Telegram
                     ◀─ ls-office-devagent   Claude Code (user ls-office-dev) untuk tim Web Dev
```

Semua antrean ada di PostgreSQL (`tasks`, `workflow_steps`, `task_runs`, `publication_jobs`, `messages`, `notifications`).
Setiap worker mengambil pekerjaan dengan row lock (`FOR UPDATE SKIP LOCKED`). Pekerjaan yang terputus karena restart
dikembalikan ke antrean saat worker hidup lagi.

| Service | User | Batas | Fungsi |
|---|---|---|---|
| ls-office-api | ls-office | 350 MB | API, login Director, streaming video |
| ls-office-worker | ls-office | 300 MB | Nadia, Felix, Ethan, Maya, Olivier, Arvin (rencana), Daren (QA video), chat |
| ls-office-render | ls-office | 1.6 GB, nice 10 | produksi video (Remotion + FFmpeg) |
| ls-office-publisher | ls-office | 250 MB | posting terjadwal |
| ls-office-telegram | ls-office | 200 MB | bot Telegram |
| ls-office-devagent | ls-office-dev | 1.2 GB, nice 10 | Nathan/Daren/Arvin menulis & merilis kode |

Kode di `/opt/ls-office` read-only untuk semua service (`ProtectSystem=strict`); data runtime di `/var/lib/ls-office`.

## Alur kerja

**Video**: Nadia (riset + 3–5 ide, *kamu pilih*) → Felix naskah → Ethan storyboard → Maya arahan suara → render →
Daren QA → *kamu review video* (approve / tulis revisi; Alex memilih tahap yang diulang, atau kamu pilih sendiri) →
Olivier caption + hashtag + jadwal → *kamu setujui/ubah* → publisher memposting pada jadwal.

**Website baru**: Nadia konsep (*pilih*) → Arvin rencana (*setujui*) → Nathan coding (Claude Code) → Daren build/test +
preview → *review preview* → Arvin rilis ke `/sites/<slug>/`.
**Update website**: daftarkan proyek di Studio → Arvin rencana (*setujui*) → Nathan coding di branch `lsai/<id>` →
Daren QA + preview → *review* → merge ke branch utama + push. Deploy production proyek itu tetap lewat pipeline proyeknya.

## Environment (`/etc/ls-office/api.env`, root:ls-office 0640)

Wajib: `DATABASE_URL`, `LS_OFFICE_ADMIN_TOKEN`, `OPENAI_API_KEY`, `LS_OFFICE_DATA=/var/lib/ls-office`, `MEDIA_SIGNING_KEY`.
Opsional: `OPENAI_MODEL` (gpt-5-mini), `OPENAI_IMAGE_MODEL` (gpt-image-2), `OPENAI_TTS_MODEL` (gpt-4o-mini-tts),
`DAILY_BUDGET_USD` (5), `MAX_DAILY_RUNS` (60), `RENDER_CONCURRENCY` (1), `TELEGRAM_BOT_TOKEN`, kredensial sosial (bawah).
Biaya yang tampil di aplikasi adalah **estimasi** dari tarif publik; tagihan resmi ada di dashboard OpenAI.

## Telegram

1. Telegram → @BotFather → `/newbot` → salin token (jangan dikirim ke chat mana pun).
2. `sudo nano /etc/ls-office/api.env` → `TELEGRAM_BOT_TOKEN=...` → `sudo systemctl restart ls-office-telegram`.
3. Command Center → Pengaturan → *Buat kode* → kirim `/link 123456` ke bot. Hanya chat itu yang dilayani.

Di Telegram: tombol Approve / Ide 1–5 / Revisi / Tolak / Posting sekarang / Ulangi; video dikirim langsung untuk review.
Revisi: tekan ✏️ lalu balas dengan teksnya. Perintah: `/status`, `/video <brief>`, `/web <brief>`, `/tugas @nama <instruksi>`.
Pesan biasa → Alex; `@nadia ...` → chat ke karyawan tertentu.

## Akun sosial (OAuth)

Isi di `api.env`, lalu `sudo systemctl restart ls-office-api ls-office-publisher` dan klik *Hubungkan akun* di Studio.

| Platform | Variabel | Redirect URI | Catatan |
|---|---|---|---|
| Instagram + Facebook | `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | `https://office.febro.id/api/social/facebook/callback` | IG harus akun Professional yang terhubung ke Facebook Page. Izin `instagram_content_publish`, `pages_manage_posts` perlu App Review untuk dipakai publik. |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | `https://office.febro.id/api/social/tiktok/callback` | Produk Content Posting API. Sebelum lolos audit, video hanya bisa terposting **private** (SELF_ONLY). |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `https://office.febro.id/api/social/youtube/callback` | Project yang belum diverifikasi Google mengunggah sebagai private. |

Juga wajib: `SOCIAL_TOKEN_ENCRYPTION_KEY` = `openssl rand -base64 32`. Token disimpan terenkripsi (AES-256-GCM).
Instagram/Facebook mengambil video lewat link publik bertanda tangan (`/api/public/media/<id>?exp&sig`, berlaku 6 jam).

**Affiliate**: isi produk + link saat membuat task video. Olivier menulis CTA yang jujur di caption. Penandaan produk
(keranjang kuning TikTok Shop / tag produk IG) belum tersedia lewat API publik, jadi dilakukan manual di aplikasi.

## Web Dev (Claude Code)

User `ls-office-dev` (tanpa sudo) menjalankan `/usr/local/bin/claude-lsai`. Kredensialnya di `/etc/ls-office/devagent.env`:
`DATABASE_URL=...` dan salah satu `CLAUDE_CODE_OAUTH_TOKEN=...` (buat dengan `claude setup-token`) atau `ANTHROPIC_API_KEY=...`.
Untuk repo GitHub: buat deploy key (`sudo -u ls-office-dev ssh-keygen -t ed25519 -f /var/lib/ls-office-dev/.ssh/id_ed25519`),
tambahkan public key sebagai *Deploy key (write)* di repo, lalu daftarkan proyek di Studio → Proyek web.
Nathan hanya boleh: baca/tulis file di worktree, `npm`, `node`, `git status/diff/log`. Push, curl/wget, sudo diblokir.

## Backup & restore

`ls-office-backup.timer` setiap hari 02:37 WIB: dump PostgreSQL (diverifikasi), media, repo Web Dev; disimpan 14 hari di
`/var/backups/ls-office`. Backup masih di disk yang sama: salin berkala ke penyimpanan lain (rekomendasi berikutnya).

Restore uji (tanpa menyentuh production):
```
sudo -u postgres createdb ls_office_restore_test
sudo pg_restore --no-owner -d ls_office_restore_test /var/backups/ls-office/daily/<file>.dump
sudo -u postgres dropdb ls_office_restore_test
```

## Deploy & rollback

```
bash scripts/deploy.sh <commit|branch>
```
Backup → checkout → `npm ci` → build web + bundle Remotion → pasang unit systemd/nginx → restart → health check.
Rollback: `bash scripts/deploy.sh <commit sebelumnya>`. Migrasi database hanya menambah (aman untuk kode lama);
restore dump hanya jika data rusak.

## Pengecekan cepat

```
systemctl status ls-office-{api,worker,render,publisher,telegram,devagent}
journalctl -u ls-office-render -f
curl -s http://127.0.0.1:3215/api/health
```
