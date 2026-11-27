# LogiSource AI Office (LS-Office)

Kantor digital berbasis AI: Director (kamu) memberi perintah, personnel AI mengerjakan tahap masing-masing,
kamu memutuskan di titik penting, lalu hasilnya terbit (video ke media sosial, website ke web).

- **Production:** https://office.febro.id
- **Repository:** https://github.com/fbrhrdynt/LS-Office
- **Versi:** 0.5.0
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
| **Studio** | seri cerita (progres per part, jeda/lanjut, produksi part berikutnya), akun sosial, jadwal posting, proyek web |
| **Pengaturan** | hubungkan Telegram, biaya AI harian (estimasi) |

Kantor 3D menampilkan status asli: ⌨️ mengetik = sedang mengerjakan tahapnya, 🙋 angkat tangan = menunggu keputusanmu,
⚠️ memegang kepala = gagal/perlu dicek, ☕ santai di meja = siap menerima perintah. Klik karyawan → buka task / chat.

## 2. Proses kerja

### Video pendek
```
Nadia riset + 3-5 ide ──▶ [KAMU pilih ide]
  ▶ Felix naskah (hanya kalimat yang diucapkan) ▶ Ethan storyboard & visual ▶ Maya arahan suara
  ▶ Production engine: gambar adegan (gpt-image-2) + suara per adegan (ElevenLabs, timing per kata ikut;
                       tanpa key ElevenLabs: OpenAI TTS + Whisper) + render Remotion (caption kinetik, label, hook)
  ▶ Daren QA (codec, resolusi, durasi) ──▶ [KAMU review video]
        ├─ approve
        └─ tulis revisi → Alex memilih tahap yang diulang (atau kamu pilih) → tim mengulang dari situ
  ▶ Olivier caption + hashtag + jadwal (+ CTA affiliate hanya jika kamu isi produk affiliate)
  ──▶ [KAMU setujui / ubah caption & waktu]  ▶ Publisher memposting tepat waktu
```

### Cerita bersambung (Part 1, 2, 3 …)
Format drama sehari-hari 1,5–2 menit per part: tokoh kartun 3D yang sama di semua part, layar HP (chat WA / saldo),
caption bawah dengan kata kunci kuning, badge "PART N", penutup "Bersambung ke Part N+1".
```
Nadia riset tema + 3-5 ide seri (arc per part) ──▶ [KAMU pilih]
  ▶ Felix rancangan seri: tokoh + daftar part + cliffhanger tiap part ──▶ [KAMU setujui]
  ▶ Ethan desain tokoh & lokasi ─▶ seri tercipta, Part 1 otomatis masuk produksi
Setiap part:
  Felix naskah (ingat part sebelumnya, ditutup cliffhanger) ▶ Ethan storyboard
  ▶ Maya memilih suara dari akun ElevenLabs → suara itu DIKUNCI untuk semua part seri
  ▶ engine: character sheet seri (dibuat sekali) dipakai sebagai referensi SETIAP gambar → tokoh konsisten
  ▶ Daren QA ──▶ [KAMU review video / revisi] ▶ Olivier caption "Part N" + jadwal ──▶ [KAMU setujui posting]
  ▶ saat kamu setujui posting Part N, Part N+1 otomatis mulai diproduksi (bisa dijeda di Studio → Seri cerita)
```
Mulai dari Command Center → `+ Perintah baru` → **🎞️ Cerita bersambung** (pilih durasi per part: ±1/±2/±3 menit), Telegram `/cerita <brief>`, atau chat ke Alex.

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
| Suara narator ElevenLabs | ✅ siap, aktif setelah `ELEVENLABS_API_KEY` diisi |
| Bot Telegram | ⏳ siap, perlu `TELEGRAM_BOT_TOKEN` |
| Posting TikTok / IG / FB / YouTube | ⏳ siap, perlu developer app + akun terhubung; belum diuji dengan akun asli |
| Video cerita bersambung (Part 1, 2, 3…) dengan tokoh konsisten | ✅ berjalan (±$1–1.5 per part, render ±5–8 menit) |

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
| 2026-11-27 | Pilihan durasi ±1 / ±2 / ±3 menit untuk Video pendek dan Cerita bersambung (per part). Panjang naskah, jumlah adegan, dan validasi mengikuti durasi; caption cerita tetap 4 kata. Perkiraan per part: 2 menit ±$1–1,5, 3 menit ±$2–2,5 + ±2.600 karakter ElevenLabs, render ±7–9 menit. |
| 2026-11-27 | Perbaikan dari Part 1 "Rumah Waris": suara seri baru dikunci setelah audio berhasil dibuat; istilah kamera (close up, shot, dll.) tidak pernah dibacakan; naskah cerita bergaya realistis (bukan dongeng); pesan error ElevenLabs (paket gratis/kuota) jelas dan bisa ditindaklanjuti. |
| 2026-11-27 | Suara Indonesia diprioritaskan: bila akun ElevenLabs punya suara berbahasa Indonesia (saat ini Putra, Yudo, Bram, Indah), Maya hanya memilih dari suara-suara itu. |
| 2026-11-27 | Suara pakai ElevenLabs (`eleven_multilingual_v2`): Maya memilih dari suara yang ada di akun, satu suara dikunci per seri, timing caption langsung dari ElevenLabs (tanpa Whisper). Tanpa `ELEVENLABS_API_KEY` otomatis kembali ke OpenAI TTS. |
| 2026-11-27 | Cerita bersambung: alur seri (ide Nadia → rancangan Felix → desain tokoh Ethan), episode otomatis per part, character sheet sebagai referensi gambar (tokoh konsisten), template Remotion "story" (badge PART, layar chat/saldo, caption bawah, "Bersambung"), tab Studio → Seri cerita, Telegram `/cerita`. |
| 2026-11-27 | Operations v2 di production: workflow video baru (pilih ide → review video → revisi bertarget → caption & jadwal), Remotion + FFmpeg, publisher terjadwal, bot Telegram, chat, tim Web Dev (Claude Code), kantor 3D berbasis status nyata, Command Center baru, migrasi bernomor, service render terpisah, backup harian, swap 2 GB, rate limit login. |
| 2026-11-26 | Fondasi OAuth sosial, perbaikan approval Command Center, audit teknis menyeluruh. |

## 6. Lisensi & kredit

Tampilan kantor 3D berbasis template Kantor AI oleh Maliki Saputra (@malikisaputra) — Lisensi Nonkomersial
Maliki Studio 1.0 (lihat `LICENSE`); kredit wajib dipertahankan. Remotion dipakai dengan Free License
(organisasi ≤ 3 orang); bila tim bertambah, beli company license.
