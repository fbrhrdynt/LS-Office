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
| **Keputusan** | semua yang menunggu kamu: pilih ide, setujui naskah, review video, setujui caption & jadwal, setujui rencana web, review preview |
| **Pekerjaan** | `+ Perintah baru` (Video pendek / Website baru / Update website / Tugas teks), daftar task + progres + biaya |
| **Chat** | tampilan seperti WhatsApp: **👥 Grup Kantor** (semua karyawan ngobrol, diskusi & debat; kamu bisa ikut/menyuruh) + chat pribadi dengan Alex atau karyawan mana pun; minta pekerjaan → jawab "ya" → jadi task |
| **Studio** | profil akun (topik, penonton, gaya, larangan), seri cerita (progres per part, jeda/lanjut, produksi part berikutnya), akun sosial, jadwal posting, proyek web |
| **Pengaturan** | hubungkan Telegram, biaya AI harian (estimasi) |

Kantor 3D berbentuk **kampus 3×3 ruangan** (`src/layout.ts`): Creative Studio · Ruang Direksi · Web Dev (belakang),
Musholla · Atrium & Lounge (Mission Board) · Ruang Rapat (tengah), Pantry & Kopi · Lobby (pintu masuk) · Marketing &
Analytics (depan), dihubungkan koridor. Di sebelah timur ada **Mess karyawan** (selasar dari koridor depan): 9 kamar
tidur (satu per karyawan) + ruang santai/makan dengan TV.

Tiap karyawan punya jadwal 24 jam sendiri (`shared/personnel.json` → `schedule`): bangun, sholat **Subuh/Dzuhur/Ashar/
Maghrib/Isya** sesuai jadwal sholat Jakarta, siap-siap & sarapan di mess, datang ke kantor, rapat pagi, ngopi, makan
siang, istirahat, pulang, mandi, makan malam & santai di mess, lalu **tidur di kamarnya** (malam hari kantor kosong,
semua bisa dipantau di mess). Sabtu–Minggu libur: santai di mess, makan di pantry, sore jalan-jalan keluar. Mereka
berjalan lewat pintu, koridor dan selasar. Pekerjaan asli menang: task yang sedang dikerjakan selalu di meja (malam =
"lembur"); menunggu keputusanmu / kendala menarik ke meja hanya saat jam kerja — di luar itu tanda "!" tetap di label.

**Kehidupan sosial** (`server/lib/social.mjs`): karyawan saling ngobrol di **Grup Kantor**. Setelah ada hasil kerja
nyata (naskah, storyboard, QA, keputusanmu) rekan setimnya berkomentar, memberi ide, menyanggah dan berdebat; jam
makan siang, ngopi sore dan malam di mess ada obrolan santai. Di kantor 3D mereka benar-benar **berkumpul** (lounge /
ruang rapat / pantry / mess) dengan balon kata sesuai chat-nya. Kepribadian per orang ada di `personality`. Obrolan
tidak boleh mengarang progres atau angka. Yang sedang tidur tidak membalas. Batas: `SOCIAL_MAX_PER_DAY` (28) obrolan
per hari, jeda `SOCIAL_GAP_MIN` (25 menit) — tiap obrolan = 1 panggilan gpt-5-mini (±$0,002).

**Kamera:** geser 1 jari / drag = pindah, **pinch / scroll = zoom ke titik**, 2 jari memutar / klik kanan / shift+drag =
putar, ketuk dua kali = lihat semua. Klik nama karyawan = kamera terbang & **mengikuti** dia; bar bawah = lompat ke
ruangan; 🎥 Tur = keliling otomatis.

Status di meja: ⌨️ mengetik = sedang mengerjakan tahapnya, 🙋 angkat tangan = menunggu keputusanmu,
⚠️ memegang kepala = gagal/perlu dicek, ☕ santai di meja = siap menerima perintah. Klik karyawan → buka task / chat.

## 2. Proses kerja

### Video pendek
```
Nadia riset + 3-5 ide (tidak mengulang ide akun yang sama) ──▶ [KAMU pilih ide]
  ▶ Felix naskah (hanya kalimat yang diucapkan)
  ▶ Daren cek naskah (hook, fokus, klaim tanpa sumber, pengulangan, gaya sesuai profil, penutup, enak diucapkan);
    ada temuan wajib → Felix memperbaiki sendiri 1× → Daren cek lagi
  ──▶ [KAMU setujui naskah] (sebelum biaya produksi keluar; bisa dimatikan per task, naskah yang tidak lolos tetap berhenti)
  ▶ Ethan storyboard & visual ▶ Maya arahan suara
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
  Felix naskah (ingat part sebelumnya, ditutup cliffhanger) ▶ Daren cek naskah ──▶ [KAMU setujui naskah] ▶ Ethan storyboard
  ▶ Maya: suara (DIKUNCI untuk semua part seri) + emosi per adegan ([whispers], [sad], [sighs]…) + sound design
    (musik latar, ambience per adegan, efek suara di momen penting)
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

### Grup Kantor (web & Telegram)
```
Kamu tulis di Grup Kantor (web: Chat → 👥 Grup Kantor, Telegram: /grup <pesan>)
  ▶ 1–3 orang paling relevan menjawab sesuai karakter (yang disebut namanya wajib jawab, boleh beda pendapat)
  ▶ kalau kamu minta pekerjaan, Alex menawarkan task → jawab "ya" → task dibuat & masuk antrean
Tim juga ngobrol sendiri (komentar hasil kerja, ide, debat, obrolan santai); Telegram `/grup on` meneruskan obrolan grup.
```

### Profil akun
Studio → **Profil akun**: tiap akun punya topik, penonton, gaya bahasa, larangan, dan catatan. Saat membuat Video pendek
/ Cerita bersambung pilih akunnya (default = profil ⭐; part seri ikut profil task awal). Profil masuk ke konteks semua
tahap kreatif (ide, naskah, cek naskah, visual, suara, caption), dan Nadia diberi daftar ide yang sudah pernah dibuat
akun itu supaya tidak mengulang.

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
| Grup Kantor (obrolan, ide, debat antar karyawan; web + Telegram), mess & kamar tidur, jadwal 24 jam | ✅ berjalan |
| Tim Web Dev (Claude Code) | ✅ diuji di dev; production perlu token Claude di `/etc/ls-office/devagent.env` |
| Suara narator ElevenLabs | ✅ siap, aktif setelah `ELEVENLABS_API_KEY` diisi |
| Bot Telegram | ✅ berjalan (@lsai_officebot terhubung) |
| Posting TikTok / IG / FB / YouTube | ⏳ siap, perlu developer app + akun terhubung; belum diuji dengan akun asli |
| Cek naskah Daren + gate "Setujui naskah" sebelum produksi, profil akun | ✅ berjalan (±$0,01–0,03 per naskah) |
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
| 2026-11-28 | **Cek naskah sebelum produksi**: tahap baru Daren memeriksa naskah Felix dengan daftar cek (hook, fokus, klaim, pengulangan, gaya, penutup, ucapan, konsistensi); temuan wajib → Felix revisi otomatis 1×; lalu gate **Setujui naskah** (web & Telegram) sebelum gambar/suara/render. Bisa dimatikan per task ("Aku cek naskahnya dulu"), tapi naskah yang tidak lolos tetap menunggu. **Profil akun** (Studio): topik, penonton, gaya, larangan per akun ikut ke semua tahap kreatif + daftar ide lama agar tidak berulang. Migrasi `006_profiles_script_check`. Perbaikan: naskah yang panjangnya meleset kini diberi koreksi konkret ("tambah ±N kata") dan 2 putaran perbaikan otomatis (sebelumnya 1, sehingga task bisa gagal setelah revisi). |
| 2026-11-27 | Chat bergaya WhatsApp/Telegram: daftar chat (Grup Kantor di atas, pesan terakhir, jam, tanda belum dibaca), percakapan dengan header status (online / di mess / sedang tidur / sedang sholat / *sedang mengetik…*), gelembung berekor, nama pengirim berwarna di grup, pemisah tanggal, centang ✓/✓✓ (biru = sudah dibalas), Enter untuk kirim. Perbaikan: balasan grup sempat gagal karena batas token model; sekarang token lebih longgar + dicoba ulang sekali, kalau tetap gagal Alex memberi tahu di grup. |
| 2026-11-27 | Kantor seperti kehidupan nyata: **Grup Kantor** (karyawan saling komentar hasil kerja, kasih ide, menyanggah, berdebat, ngobrol santai; Director bisa baca & menyuruh lewat web dan Telegram `/grup`), karyawan berkumpul + balon kata di 3D saat ngobrol; **Mess karyawan** dengan 9 kamar tidur + ruang santai; jadwal 24 jam (bangun, Subuh, sarapan, kerja, pulang, makan malam, Isya, tidur), akhir pekan di mess. Migrasi `005_office_social`. |
| 2026-11-27 | Kantor jadi kampus 3×3 (9 ruangan dengan pintu & koridor, bukan memanjang) + kamera baru: pan, pinch/scroll zoom ke titik, putar, fokus & ikuti karyawan, lompat ruangan, tur opsional. Gaya `gedung30` menampilkan kampus diperkecil (sebagian tertutup lantai gedung). |
| 2026-11-27 | Kantor 3D realistis: sayap musholla + pantry & kopi dan ruang rapat + lounge, pintu masuk; jadwal harian per karyawan (datang, rapat pagi, ngopi, makan siang, sholat sesuai jadwal sholat Jakarta, istirahat, pulang) dengan jalan bertujuan lewat koridor dan pose sholat/makan/rapat/santai; label ruangan; jadwal sholat berikutnya di HUD. Status kerja asli tetap prioritas. |
| 2026-11-27 | Ganti suara seri: tulis nama suara di revisi (mis. "ganti suara ke Yudo") atau pilih di Studio → Seri cerita → Suara narator. Sebelumnya suara terkunci ke pilihan pertama dan revisi suara diabaikan. |
| 2026-11-27 | Narasi emosional + sound design: model suara `eleven_v3` dengan tag emosi per adegan dari Maya; musik instrumental (ElevenLabs Music) yang otomatis mengecil saat narator bicara, ambience per adegan, dan efek suara (ElevenLabs Sound Effects), di-mix dengan FFmpeg. Butuh izin **Sound Effects** dan **Music Generation** di API key ElevenLabs; tanpa izin, video tetap jadi dengan narasi emosional saja. Matikan dengan `SOUND_DESIGN=off`. |
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
