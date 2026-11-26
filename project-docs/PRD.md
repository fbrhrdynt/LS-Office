# PRD · Ubah template Kantor AI 3D + Paket 3 Agent "LogiSource Digital AI Office"

Versi 1 · 26 Nov 2026 · Dibuat dengan Pembuat PRD (malikisaputra.biz.id/prd)

## 1. Ringkasan
Ubah tampilan template "Kantor AI 3D + Paket 3 Agent" agar sesuai usahaku LogiSource Digital, tanpa merusak fitur yang sudah ada.

## 2. Tujuan & ukuran berhasil
| # | Tujuan | Ukuran berhasil (bisa dicek) |
|---|---|---|
| T1 | Tampilan baru sesuai gaya usahaku | Pola tata letak di bagian 6 terlihat jelas |
| T2 | Semua fitur lama tetap berfungsi | npm install; npm run build lolos |
| T3 | Rapi di HP & laptop | Tidak ada scroll ke samping di lebar 375 px |

## 3. Pengguna
1. **Pelanggan/pengguna usahaku**: membuka dari HP

## 4. Lingkup
**Masuk:**
- Mengubah tampilan: src/styles.css, markup & className di src/App.tsx

**Tidak masuk (jangan dibuat):**
- Mengubah logika/JavaScript dan format data
- Menambah fitur baru
- Mengubah berkas terkunci: src/office.ts, src/config.ts, src/OfficeScene.tsx, src/gaya/*, src/laporan.json (format)

## 5. Fitur / layar (urut dari awal)
| # | Fitur | Yang bisa dilakukan pengguna | Teks persis |
|---|---|---|---|
| 1 | Kantor 3D isometrik, ringan di HP | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 2 | Agen mengetik saat jam tugas, laporan sore, santai & ngopi | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 3 | Gelembung ringkasan, tanda ! menunggu keputusan, meja berkedip mendesak | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 4 | Timelapse satu hari kerja dalam 30 detik | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 5 | Rekam jadi video reels 1080×1920 | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 6 | Laporan agen dibaca dari src/laporan.json | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |
| 7 | Paket 3 agent terpisah | Tetap berfungsi; tampilannya mengikuti gaya baru | (tulis singkat, netral, tanpa klaim) |

## 6. Arah desain
- **Pola tata letak (Dashboard kaca):** bar atas kaca (logo, jam, LIVE, tombol gaya), panel agen ringkas di kiri yang bisa diciutkan, laci laporan di kanan; panel tidak boleh menutupi lebih dari 25% kantor 3D.
- **Warna & font:** Utama #101827 (Midnight Navy), sekunder #1D2939 (Slate), latar #F5F3EE (Warm Ivory), aksen #F28C28 (Amber) dan #35B8A5 (Teal); font Inter.
- **Animasi:**
  - elemen muncul (fade + naik 16 px, 400–600 ms) saat masuk layar, pakai IntersectionObserver.
  - kartu & tombol terangkat 2–4 px dengan bayangan saat disentuh kursor (200 ms).
  - Semua animasi mati bila pengguna memilih `prefers-reduced-motion`.
- **Hindari tampilan template:** jangan semua bagian rata tengah; jangan tiga kartu kembar tanpa variasi; jangan gradien ungu-biru acak; jangan emoji sebagai ikon; beri jarak antarbagian yang lega (minimal 96 px di laptop).

## 7. Persyaratan
- R1. Install Node.js 20+, lalu npm install dan npm run dev
- R2. Buka http://localhost:5173 (coba /?timelapse=1)
- R3. Ubah nama kantor, agen, dan jadwal di src/config.ts

**Wajib dipertahankan (jangan dihapus, diganti nama, atau dipindah ke elemen lain):**
- Berkas terkunci (logika): src/office.ts, src/config.ts, src/OfficeScene.tsx, src/gaya/*, src/laporan.json (format)
- semua state/prop/handler di App.tsx .ko-stage .ko-layer ref ke OfficeScene
- Kelas yang dibuat oleh JavaScript tetap harus punya gaya di CSS.

**Cara uji fitur setelah diubah:**
1. npm install
2. npm run build lolos
3. npm test lulus
4. npm run dev: kantor 3D tampil, ganti gaya jalan, panel tidak menutupi kantor

## 8. Fakta yang boleh dipakai
Belum ada. Bila butuh kontak, harga, atau angka, tulis tanda [ISI: …] dan jangan mengarang.

## 9. Larangan (penting)
- Jangan menambah angka (jumlah klien, tahun, rating, statistik) yang tidak tertulis di PRD.
- Jangan menulis harga atau promo yang tidak tertulis di PRD.
- Jangan membuat testimoni, ulasan, atau logo klien.
- Jangan menambah janji atau garansi ("24 jam", "pasti laku").
- Jangan menambah fitur atau bagian di luar lingkup.

## 10. Kriteria selesai
1. Ketika hasil dicek untuk tujuan T1, maka pola tata letak di bagian 6 terlihat jelas.
2. Ketika hasil dicek untuk tujuan T2, maka npm install; npm run build lolos.
3. Ketika hasil dicek untuk tujuan T3, maka tidak ada scroll ke samping di lebar 375 px.
4. Ketika pengguna menjalankan setiap fitur di tabel, maka fitur itu bekerja tanpa error di Console.
5. Ketika halaman dimuat ulang, maka data yang sudah dimasukkan tetap ada.
6. Ketika dibuka di HP lebar 375 px, maka semua tombol bisa ditekan dan tidak ada yang terpotong.
7. Ketika seluruh hasil dibaca, maka tidak ada yang melanggar bagian 9 (Larangan).

## 11. Langkah kerja (ikuti berurutan, jangan berhenti di tengah)
1. Baca seluruh PRD dan TASKS. Bila ada [ISI: …] atau yang tidak jelas, tanyakan dulu ke saya. Jangan menebak.
2. Pelajari template asli dan jalankan cara uji di bagian 7 sebelum mengubah apa pun.
3. Ubah tampilan per task (TASKS.md), hanya di berkas yang aman; jaga semua selector di bagian 7.
4. Setelah tiap task, jalankan lagi cara uji fitur. Bila ada yang rusak, kembalikan dulu sebelum lanjut.
5. Cek kriteria selesai, lalu laporkan berkas yang diubah dan hasil uji.
