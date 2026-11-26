# TASKS · Ubah template Kantor AI 3D + Paket 3 Agent "LogiSource Digital AI Office"

Kerjakan **satu task per giliran**, berurutan. Setelah tiap task: cek "Selesai bila", lalu tulis `✅ T# selesai` dan lanjut ke task berikutnya.
Acuan lengkap ada di PRD.md. Bila task dan PRD berbeda, ikuti PRD.

## T0 · Pelajari template dulu (jangan ubah apa pun)
- Baca README, AGENTS.md/DESIGN.md (bila ada), lalu berkas yang aman diubah.
- Catat semua selector di bagian 7 "Wajib dipertahankan" dan cari di mana dipakai.
- Jalankan cara uji di bagian 7 pada versi asli, catat hasilnya sebagai patokan.
- **Selesai bila:** kamu bisa menyebut berkas mana yang akan diubah dan selector mana yang dijaga.

## T1 · Ganti token desain (warna, font, radius)
- Ubah hanya berkas yang aman (bagian 4 Lingkup); jangan sentuh berkas terkunci di bagian 7.
- Simpan warna dan font dari bagian 6 (Arah desain) sebagai variabel/gaya bersama.
- Atur skala tipografi yang konsisten.
- **Selesai bila:** file terbuka di browser tanpa error, warna & font sudah sesuai.

## T2 · Fitur "Kantor 3D isometrik, ringan di HP"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T3 · Fitur "Agen mengetik saat jam tugas, laporan sore, santai & ngopi"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T4 · Fitur "Gelembung ringkasan, tanda ! menunggu keputusan, meja berkedip mendesak"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T5 · Fitur "Timelapse satu hari kerja dalam 30 detik"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T6 · Fitur "Rekam jadi video reels 1080×1920"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T7 · Fitur "Laporan agen dibaca dari src/laporan.json"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T8 · Fitur "Paket 3 agent terpisah"
- Isi: Tetap berfungsi; tampilannya mengikuti gaya baru
- Ikuti nuansa bagian 6; buat tata letaknya berbeda dari bagian sebelumnya (jangan monoton).
- **Selesai bila:** isi lengkap sesuai tabel, rapi di lebar 375 px dan laptop, tidak melanggar Larangan.

## T9 · Animasi & momen pembeda
- elemen muncul (fade + naik 16 px, 400–600 ms) saat masuk layar, pakai IntersectionObserver.
- kartu & tombol terangkat 2–4 px dengan bayangan saat disentuh kursor (200 ms).
- Matikan animasi untuk `prefers-reduced-motion`.
- **Selesai bila:** animasi halus (tanpa patah), momen pembeda terlihat jelas.

## T10 · Uji ulang fitur template
- npm install
- npm run build lolos
- npm test lulus
- npm run dev: kantor 3D tampil, ganti gaya jalan, panel tidak menutupi kantor
- Bandingkan dengan hasil uji versi asli dari task pertama.
- **Selesai bila:** semua fitur bekerja sama seperti versi asli.

## T11 · Pemeriksaan akhir
- Cek bagian 10 (Kriteria selesai) PRD satu per satu.
- Cari pelanggaran bagian 9 (Larangan): angka, harga, testimoni, janji, nama karangan.
- Perbaiki yang belum lolos, lalu laporkan daftar kriteria + statusnya.
- **Selesai bila:** semua kriteria berstatus lolos.
