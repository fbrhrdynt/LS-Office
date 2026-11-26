# Kantor AI · aturan bersama semua agent
- Jawab pakai bahasa Indonesia santai.
- Ini kantor AI: tiap agent menulis laporan hariannya ke src/laporan.json.
- Format laporan tiap agent:
  {"ringkasan": "...", "menunggu": ["..."], "mendesak": ["..."], "angka": [{"label": "...", "nilai": "..."}]}
- Kunci agent di laporan.json harus sama dengan key di src/config.ts (AGEN): raka, sekar, lita.
- Laporan agent lain di laporan.json jangan dihapus, cukup perbarui kunci milikmu.
- Jangan menulis nominal uang atau data rahasia.
