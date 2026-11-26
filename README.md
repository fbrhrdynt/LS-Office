# LogiSource AI Office (LS-Office)

Kantor digital berbasis AI: Director (kamu) memberi perintah, personnel AI mengerjakan tahap masing-masing,
kamu memutuskan di titik penting, lalu hasilnya terbit (video ke media sosial, website ke web).

- **Production:** https://office.febro.id
- **Repository:** https://github.com/fbrhrdynt/LS-Office
- **Versi:** 0.4.0
- **Bahasa kerja:** Indonesia
- Detail operasional (service, env, Telegram, OAuth, backup, deploy): [`docs/OPERATIONS.md`](docs/OPERATIONS.md)

---

## 1. Cara pakai (Director)

Buka https://office.febro.id → **⌘ Command Center** → login. Atau lewat **Telegram** setelah bot dihubungkan.

| Tab | Isi |
|---|---|
| **Keputusan** | semua yang menunggu kamu: pilih ide, review video, setujui caption & jadwal, setujui rencana web, review preview |
| **Pekerjaan** | `+ Perintah baru` (Video pendek / Website baru / Update website / Tugas teks), daftar task + progres + biaya |
| **Chat** | chat dengan Alex atau karyawan mana pun; minta pekerjaan lewat chat → jawab "ya" → jadi task |
| **Studio** | hubungkan akun TikTok/IG/FB/YouTube, jadwal posting, daftar proyek web |
| **Pengaturan** | hubungkan Telegram, biaya AI harian (estimasi) |

Kantor 3D menampilkan status asli: ⌨️ mengetik = sedang mengerjakan tahapnya, 🙋 angkat tangan = menunggu keputusanmu,
⚠️ memegang kepala = gagal/perlu dicek, ☕ santai di meja = siap menerima perintah. Klik karyawan → buka task / chat.

## 2. Proses kerja

### Video pendek
```
Nadia riset + 3-5 ide ──▶ [KAMU pilih ide]
  ▶ Felix naskah (hanya kalimat yang diucapkan) ▶ Ethan storyboard & visual ▶ Maya arahan suara
  ▶ Production engine: gambar adegan (gpt-image-2) + suara per adegan (gpt-4o-mini-tts)
                       + timing per kata (Whisper) + render Remotion (caption kinetik, label, hook)
  ▶ Daren QA (codec, resolusi, durasi) ──▶ [KAMU review video]
        ├─ approve
        └─ tulis revisi → Alex memilih tahap yang diulang (atau kamu pilih) → tim mengulang dari situ
  ▶ Olivier caption + hashtag + jadwal (+ CTA affiliate hanya jika kamu isi produk affiliate)
  ──▶ [KAMU setujui / ubah caption & waktu]  ▶ Publisher memposting tepat waktu
```

### Website baru / update website
```
(Website baru) Nadia konsep ──▶ [KAMU pilih]
Arvin rencana teknis ──▶ [KAMU setujui]
  ▶ Nathan coding (Claude Code, user terisolasi, branch lsai/<id>) ▶ Daren install/build/test + preview
  ──▶ [KAMU review preview]  (revisi → kembali ke Arvin/Nathan)
  ▶ Arvin rilis: website baru → https://office.febro.id/sites/<slug>/ · proyek lama → merge + push ke repo
```

### Aturan yang dijaga sistem
- Tidak ada yang terbit tanpa persetujuanmu; agen tidak mengklaim hasil yang tidak ada.
- Output AI divalidasi (narasi tanpa catatan produksi, durasi, caption tanpa catatan internal); bila gagal, agen
  memperbaiki sendiri satu kali, kalau masih gagal task berhenti dan kamu bisa **Ulangi**.
- Budget harian (default $5, estimasi) dan batas run harian; worker berhenti mengambil pekerjaan bila tercapai.

## 3. Status fitur

| Fitur | Status |
|---|---|
| Command Center, approval, revisi, retry/cancel, biaya per task | ✅ berjalan |
| Video pendek (explainer & cards) end-to-end | ✅ berjalan (uji: ±$0.42/video, render ±3 menit) |
| Chat web dengan Alex & personnel | ✅ berjalan |
| Kantor 3D berbasis status nyata | ✅ berjalan |
| Tim Web Dev (Claude Code) | ✅ diuji di dev; production perlu token Claude di `/etc/ls-office/devagent.env` |
| Bot Telegram | ⏳ siap, perlu `TELEGRAM_BOT_TOKEN` |
| Posting TikTok / IG / FB / YouTube | ⏳ siap, perlu developer app + akun terhubung; belum diuji dengan akun asli |
| Video cerita bersambung (Part 1, 2, 3…) | 🚧 sedang dibangun |

## 4. Developer guide

| Bagian | Lokasi |
|---|---|
| Frontend (kantor 3D + Command Center) | `src/` (`App.tsx`, `OfficeScene.tsx`, `cc/`) |
| API | `server/index.mjs` |
| Worker AI / render / publisher / Telegram / Web Dev | `server/worker.mjs`, `server/render-worker.mjs`, `server/publisher.mjs`, `server/telegram.mjs`, `server/devagent.mjs` |
| Mesin workflow & definisi alur | `server/lib/engine.mjs`, `server/workflows.mjs` |
| Template video | `remotion/` |
| Data personnel (satu sumber) | `shared/personnel.json` |
| Migrasi database | `server/migrations/NNN_*.sql` (berurutan, sekali jalan) |
| Unit systemd, nginx, backup | `ops/` |

```
npm ci
npm test && npm run test:workflow && npm run test:social-oauth
npm run build && npm run build:remotion
npm run dev                      # frontend, proxy /api ke LS_API (default 127.0.0.1:3215)
bash scripts/deploy.sh <ref>     # deploy production (backup → build → restart → health)
```

Aturan kerja: kembangkan di branch/worktree terpisah dan database dev (salinan dari backup), bukan di
`/opt/ls-office` atau database production. Setiap perubahan proses **wajib** memperbarui README ini dan Progress log.

## 5. Progress log

| Tanggal | Perubahan |
|---|---|
| 2026-11-27 | Operations v2 di production: workflow video baru (pilih ide → review video → revisi bertarget → caption & jadwal), Remotion + FFmpeg, publisher terjadwal, bot Telegram, chat, tim Web Dev (Claude Code), kantor 3D berbasis status nyata, Command Center baru, migrasi bernomor, service render terpisah, backup harian, swap 2 GB, rate limit login. |
| 2026-11-26 | Fondasi OAuth sosial, perbaikan approval Command Center, audit teknis menyeluruh. |

## 6. Lisensi & kredit

Tampilan kantor 3D berbasis template Kantor AI oleh Maliki Saputra (@malikisaputra) — Lisensi Nonkomersial
Maliki Studio 1.0 (lihat `LICENSE`); kredit wajib dipertahankan. Remotion dipakai dengan Free License
(organisasi ≤ 3 orang); bila tim bertambah, beli company license.
