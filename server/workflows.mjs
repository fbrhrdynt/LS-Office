/**
 * Workflow definitions. Each step is done by one employee (or an engine) and may end at a Director gate.
 *  executor: agent (LLM call), render (video engine), qa (deterministic checks), devagent (Claude Code in an isolated workspace)
 *  gate: the step's output waits for a Director decision before the workflow continues.
 *  revisable: steps the Director may send a revision back to from this gate.
 */

const IDEA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ideas', 'recommendation'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'hook', 'angle', 'format', 'why_it_works', 'key_facts', 'sources', 'affiliate_fit'],
        properties: {
          title: { type: 'string' },
          hook: { type: 'string', description: 'First 2 seconds on screen/voice, a question or bold claim' },
          angle: { type: 'string' },
          format: { type: 'string', enum: ['explainer', 'cards'], description: 'explainer = cinematic illustrated scenes; cards = dark motion-graphics UI cards, lists, numbers' },
          why_it_works: { type: 'string' },
          key_facts: { type: 'array', items: { type: 'string' } },
          sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
          affiliate_fit: { type: 'string', description: 'Product category that fits naturally, or "tidak cocok"' },
        },
      },
    },
    recommendation: { type: 'string' },
  },
};

const STORYBOARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'template', 'hook_text', 'visual_style', 'character_bible', 'scenes'],
  properties: {
    title: { type: 'string' },
    template: { type: 'string', enum: ['explainer', 'cards', 'story'] },
    hook_text: { type: 'string', description: 'Max 8 words, big text over the first scene' },
    visual_style: { type: 'string', description: 'English art direction applied to every image prompt' },
    character_bible: { type: 'string', description: 'English, exact recurring character appearance, or "none"' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['narration', 'image_prompt', 'labels', 'card'],
        properties: {
          narration: { type: 'string', description: 'Exact Indonesian words spoken in this scene, 1-3 short sentences' },
          image_prompt: { type: 'string', description: 'English prompt for one vertical frame, no text in image. Empty string if the scene uses only a card.' },
          labels: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['text', 'x', 'y'], properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
          },
          card: {
            type: 'object', additionalProperties: false, required: ['kind', 'heading', 'items', 'value', 'highlight'],
            properties: {
              kind: { type: 'string', enum: ['none', 'list', 'stat', 'compare', 'steps', 'quote', 'chat', 'phone'], description: 'chat = phone chat screen, items "Nama: pesan" (pesan dari tokoh utama pakai nama tokoh utama); phone = phone app screen, heading = app/notification title, value = big text (e.g. saldo), items = lines' },
              heading: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } },
              value: { type: 'string', description: 'Number for stat cards (e.g. 10000000000), else empty' },
              highlight: { type: 'integer', description: 'Index of the highlighted item, -1 if none' },
            },
          },
        },
      },
    },
  },
};

const AUDIO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['voice', 'instructions', 'pronunciations', 'notes'],
  properties: {
    voice: { type: 'string', enum: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] },
    instructions: { type: 'string', description: 'English delivery direction for the TTS engine: persona, energy, pace, emotion, pauses' },
    pronunciations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['written', 'spoken'], properties: { written: { type: 'string' }, spoken: { type: 'string' } } },
    },
    notes: { type: 'string' },
  },
};

const DISTRIBUTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['posts', 'recommended_time', 'schedule_reason', 'affiliate_cta'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['platform', 'title', 'caption', 'hashtags'],
        properties: {
          platform: { type: 'string', enum: ['tiktok', 'instagram', 'youtube', 'facebook'] },
          title: { type: 'string' },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    recommended_time: { type: 'string', description: 'Local time in Asia/Jakarta, format YYYY-MM-DD HH:mm, in the future' },
    schedule_reason: { type: 'string' },
    affiliate_cta: { type: 'string', description: 'Natural call to action for the affiliate product, or empty string' },
  },
};

const SCRIPT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'hook_line', 'scenes', 'word_count'],
  properties: {
    title: { type: 'string' },
    hook_line: { type: 'string', description: 'First spoken sentence, max 10 words, a question or bold claim' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['spoken', 'visual_note'],
        properties: {
          spoken: { type: 'string', description: 'ONLY the words the narrator says. No labels, no directions, no brackets, no timestamps.' },
          visual_note: { type: 'string', description: 'What should be seen (for Ethan). Never spoken.' },
        },
      },
    },
    word_count: { type: 'integer', description: 'Total words across all spoken fields' },
  },
};

const SERIES_IDEA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ideas', 'recommendation'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'hook', 'angle', 'format', 'why_it_works', 'key_facts', 'sources', 'affiliate_fit'],
        properties: {
          title: { type: 'string', description: 'Series title' },
          hook: { type: 'string', description: 'Opening line of Part 1 that makes people stop scrolling' },
          angle: { type: 'string', description: 'Premise: main character, problem, what is at stake' },
          format: { type: 'string', enum: ['story'] },
          why_it_works: { type: 'string', description: 'Why viewers will follow every part: relatable pain, open loops, cliffhanger engine' },
          key_facts: { type: 'array', items: { type: 'string' }, description: 'Planned arc, one line per part (5-8 parts)' },
          sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } }, description: 'Trend references actually opened (may be empty)' },
          affiliate_fit: { type: 'string' },
        },
      },
    },
    recommendation: { type: 'string' },
  },
};

const SERIES_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'logline', 'tone', 'characters', 'episodes'],
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    tone: { type: 'string' },
    characters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'role', 'personality', 'arc'], properties: { name: { type: 'string' }, role: { type: 'string' }, personality: { type: 'string' }, arc: { type: 'string' } } } },
    episodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['part', 'title', 'summary', 'cliffhanger'], properties: { part: { type: 'integer' }, title: { type: 'string' }, summary: { type: 'string' }, cliffhanger: { type: 'string', description: 'Last beat that makes viewers wait for the next part; for the final part, the resolution' } } } },
  },
};

const CHARACTER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['visual_style', 'characters', 'locations'],
  properties: {
    visual_style: { type: 'string', description: 'English art direction for every frame of the series' },
    characters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'appearance'], properties: { name: { type: 'string' }, appearance: { type: 'string', description: 'English, exact and unchanging: body shape, face, hair/hijab, clothes with colors, accessories' } } } },
    locations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string', description: 'English' } } } },
  },
};

const WEB_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'stack', 'pages', 'features', 'acceptance_criteria', 'risks'],
  properties: {
    summary: { type: 'string' },
    stack: { type: 'string' },
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'purpose'], properties: { path: { type: 'string' }, purpose: { type: 'string' } } } },
    features: { type: 'array', items: { type: 'string' } },
    acceptance_criteria: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
};

export const SCHEMAS = { IDEA_SCHEMA, SERIES_IDEA_SCHEMA, SERIES_PLAN_SCHEMA, CHARACTER_SCHEMA, SCRIPT_SCHEMA, STORYBOARD_SCHEMA, AUDIO_SCHEMA, DISTRIBUTION_SCHEMA, WEB_PLAN_SCHEMA };

const ideas = (kind) => ({
  key: 'ideas', employeeId: 'nadia', executor: 'agent', gate: 'choose_idea', schema: 'IDEA_SCHEMA', webSearch: true,
  title: kind === 'video' ? 'Ide konten & riset' : 'Ide & konsep website',
  instruction: kind === 'video'
    ? 'Riset dan usulkan 3-5 ide video pendek vertikal (TikTok/Reels, durasi sesuai TARGET DURASI di konteks) yang berpotensi viral sesuai brief. Format "explainer" = adegan ilustrasi sinematik ala animasi 3D yang menjelaskan "kenapa/bagaimana" dengan label dan panah; format "cards" = motion graphics kartu UI gelap, daftar Top-N, angka yang naik. Tiap ide wajib punya hook 2 detik yang kuat, fakta kunci yang benar-benar bisa diverifikasi, dan sumber nyata (URL) dari web search. Nilai juga kecocokan untuk affiliate. Jangan menulis naskah.'
    : 'Riset dan usulkan 3-5 konsep website sesuai brief: target pengguna, masalah yang diselesaikan, fitur inti, referensi nyata, dan alasan. Isi field format dengan "explainer" untuk website konten/landing dan "cards" untuk aplikasi/dashboard. Jangan menulis kode.',
});

export const VIDEO_WORKFLOW = [
  ideas('video'),
  { key: 'script', employeeId: 'felix', executor: 'agent', schema: 'SCRIPT_SCHEMA', title: 'Naskah', instruction: 'Tulis naskah voice-over berbahasa Indonesia yang natural dan cepat untuk ide terpilih: panjang dan jumlah adegan sesuai TARGET DURASI di konteks. Field spoken HANYA berisi kata yang diucapkan narator: tanpa label (Visual/Catatan/Hook/CTA), tanpa arahan kamera, tanpa tanda kurung, tanpa timestamp. Arahan visual tulis di visual_note. Kalimat pendek, hook kuat di adegan 1 (sama dengan hook_line), penjelasan runtut, insight/twist, penutup + CTA singkat (follow, atau cek link di bio bila ada affiliate). Hanya pakai fakta dari riset Nadia. Tulis angka dan istilah apa adanya (Maya yang mengatur pengucapan).' },
  { key: 'storyboard', employeeId: 'ethan', executor: 'agent', schema: 'STORYBOARD_SCHEMA', title: 'Storyboard & visual', instruction: 'Ubah naskah Felix menjadi storyboard produksi. Field narration = SALIN PERSIS field spoken dari naskah Felix (boleh dipecah/digabung per adegan, jangan menambah, mengurangi, atau mengubah kata). visual_note Felix dipakai untuk image_prompt dan label, BUKAN narasi. hook_text = hook_line Felix (maks 10 kata). Template mengikuti format ide terpilih. Untuk "explainer": tiap adegan punya image_prompt sinematik (gaya render 3D stylized, karakter konsisten sesuai character_bible, komposisi vertikal, tanpa teks) dan 0-2 label penunjuk (x,y 0-1) berbahasa Indonesia, maksimal 3 kata, di luar area tengah-bawah layar (y < 0.5 atau y > 0.75) karena area itu untuk caption. Untuk "cards": gunakan card (list/stat/compare/steps/quote) di hampir semua adegan; image_prompt boleh kosong. jumlah adegan sesuai TARGET DURASI di konteks, maksimal 3 label per adegan, maksimal 6 item per card.' },
  { key: 'audio_direction', employeeId: 'maya', executor: 'agent', schema: 'AUDIO_SCHEMA', title: 'Arahan suara', instruction: 'Tentukan suara TTS dan arahan penyampaian (bahasa Inggris, untuk engine TTS) yang cocok untuk naskah: persona narator, energi, tempo cepat ala TikTok, emosi, jeda. Daftarkan pengucapan untuk angka, singkatan, simbol, dan istilah asing (written -> spoken dalam bahasa Indonesia), misalnya "4.000 °C" -> "empat ribu derajat celcius".' },
  { key: 'render_video', employeeId: null, executor: 'render', title: 'Produksi video', instruction: 'Buat gambar adegan, voice-over, caption per kata, dan render MP4 vertikal dengan Remotion.' },
  { key: 'qa_video', employeeId: 'daren', executor: 'qa', gate: 'video_review', revisable: ['script', 'storyboard', 'audio_direction', 'render_video'], title: 'QA & review video', instruction: 'Periksa file MP4: stream video/audio, resolusi, durasi, ukuran. Lolos QA lalu menunggu review Director.' },
  { key: 'distribution', employeeId: 'olivier', executor: 'agent', schema: 'DISTRIBUTION_SCHEMA', gate: 'publish', title: 'Caption & jadwal posting', instruction: 'Siapkan caption per platform (TikTok, Instagram; YouTube Shorts/Facebook bila relevan), hashtag yang relevan (5-8, campuran niche dan luas), judul singkat, dan rekomendasi waktu posting (WIB, di masa depan) beserta alasannya berdasarkan kebiasaan audiens Indonesia. Isi affiliate_cta HANYA jika brief menyebut produk affiliate; jika tidak ada, affiliate_cta kosong dan jangan menyebut affiliate. Hook caption pakai hook final dari naskah Felix. Field caption/title/hashtags akan TAYANG PUBLIK apa adanya: jangan menulis catatan internal, status produksi, nama tim, atau instruksi di sana. Catatan untuk Director tulis di schedule_reason. Jangan memublikasikan apa pun.' },
];

export const WEB_BUILD_WORKFLOW = [
  ideas('web'),
  { key: 'plan', employeeId: 'arvin', executor: 'agent', schema: 'WEB_PLAN_SCHEMA', gate: 'approve_plan', title: 'Rencana teknis', instruction: 'Susun rencana teknis website baru dari ide terpilih. Default stack: Vite + vanilla/React statis (build ke folder dist) kecuali brief meminta lain. Tulis halaman, fitur, acceptance criteria yang bisa dites, dan risiko. Jangan menulis kode.' },
  { key: 'implement', employeeId: 'nathan', executor: 'devagent', title: 'Implementasi', instruction: 'Implementasikan rencana Arvin di workspace proyek. Pastikan build berhasil.' },
  { key: 'qa_web', employeeId: 'daren', executor: 'devagent', gate: 'web_review', revisable: ['plan', 'implement'], title: 'QA & preview', instruction: 'Jalankan install, build, dan test; siapkan preview untuk review Director.' },
  { key: 'release', employeeId: 'arvin', executor: 'devagent', title: 'Rilis', instruction: 'Gabungkan perubahan yang disetujui ke branch utama dan publikasikan.' },
];

export const WEB_UPDATE_WORKFLOW = [
  { key: 'plan', employeeId: 'arvin', executor: 'agent', schema: 'WEB_PLAN_SCHEMA', gate: 'approve_plan', title: 'Rencana teknis', instruction: 'Pelajari permintaan Director untuk proyek yang sudah ada. Susun rencana perubahan: halaman/fitur yang disentuh, acceptance criteria yang bisa dites, risiko regresi. Jangan menulis kode.' },
  WEB_BUILD_WORKFLOW[2],
  WEB_BUILD_WORKFLOW[3],
  WEB_BUILD_WORKFLOW[4],
];

export const STORY_SERIES_WORKFLOW = [
  { key: 'ideas', employeeId: 'nadia', executor: 'agent', gate: 'choose_idea', schema: 'SERIES_IDEA_SCHEMA', webSearch: true, title: 'Ide cerita bersambung', instruction: 'Usulkan 3-5 konsep cerita drama bersambung orisinal untuk TikTok/Reels (5-8 part, durasi tiap part sesuai TARGET DURASI di konteks). Gaya: kisah sehari-hari orang Indonesia yang relatable (keuangan keluarga, utang, kerja, kos, keluarga, persahabatan), konflik emosional, ditutup cliffhanger tiap part agar penonton menunggu part berikutnya. Tokoh, nama, dan alur harus orisinal (jangan meniru akun/seri yang sudah ada). Riset singkat tema yang sedang ramai dengan web_search bila berguna. Isi key_facts dengan rencana arc per part (satu baris per part). Jangan menulis naskah.' },
  { key: 'series_plan', employeeId: 'felix', executor: 'agent', schema: 'SERIES_PLAN_SCHEMA', gate: 'approve_series', title: 'Rancangan seri & daftar part', instruction: 'Kembangkan ide terpilih menjadi rancangan seri: judul, logline, tone, tokoh (nama Indonesia orisinal, peran, sifat, arc), dan daftar part (jumlah sesuai ide/brief, 5-8 bila tidak ditentukan). Tiap part: judul, ringkasan, dan cliffhanger yang membuat penonton menunggu. Part terakhir berisi penyelesaian yang memuaskan. Konsisten dan logis antar part.' },
  { key: 'character_design', employeeId: 'ethan', executor: 'agent', schema: 'CHARACTER_SCHEMA', title: 'Desain tokoh & lokasi', instruction: 'Tetapkan gaya visual seri dan desain tokoh yang tidak berubah sepanjang seri. Gaya default: simple stylized 3D cartoon, rounded bean-shaped characters with oversized round heads, small dot eyes, soft matte look, pastel colors, warm cinematic lighting (orisinal, bukan karakter milik pihak lain). Tulis appearance tiap tokoh dalam bahasa Inggris sangat spesifik (bentuk tubuh, wajah, rambut/hijab, pakaian dan warna, aksesori). Daftarkan 3-6 lokasi yang sering muncul.' },
];

const episode = (key, extra) => ({ ...VIDEO_WORKFLOW.find((s) => s.key === key), ...extra });
export const STORY_EPISODE_WORKFLOW = [
  episode('script', { instruction: 'Tulis naskah narasi part ini dalam bahasa Indonesia sehari-hari yang REALISTIS, seperti seseorang menceritakan kisah nyata orang yang ia kenal kepada temannya: lugas, detail konkret (nominal, jam, isi chat, tempat), emosi lewat kejadian bukan kata sifat berlebihan. JANGAN bernada dongeng (hindari "Alkisah", "Pada suatu hari", "di sebuah desa", kalimat puitis berlebihan). Sudut pandang orang ketiga menyebut nama tokoh, kalimat pendek: panjang dan jumlah adegan sesuai TARGET DURASI di konteks. Part 2 dan seterusnya dibuka dengan satu kalimat pengingat singkat kejadian part sebelumnya. Ikuti ringkasan part ini dari rancangan seri dan jaga konsistensi dengan part sebelumnya. Tutup dengan cliffhanger part ini (kecuali part terakhir: penyelesaian). Field spoken HANYA kalimat narator (boleh menyebut isi chat/notifikasi secara singkat), tanpa label/arahan/tanda kurung dan tanpa istilah kamera (close up, shot, frame, menunjukkan tekstur, dll.); semua arahan visual di visual_note, termasuk kapan layar HP (chat/saldo) ditampilkan. hook_line = kalimat pertama.' }),
  episode('storyboard', { instruction: 'Ubah naskah Felix menjadi storyboard part ini dengan template "story". Field narration = SALIN PERSIS field spoken Felix (boleh dipecah/digabung, jangan menambah/mengubah kata). jumlah adegan sesuai TARGET DURASI di konteks. image_prompt bahasa Inggris: sebut nama tokoh dan aksi/ekspresi/lokasi; penampilan tokoh mengikuti desain tokoh seri (akan dipasangkan dengan character sheet). Untuk momen layar HP gunakan card kind "chat" (items "Nama: pesan") atau "phone" (heading judul aplikasi/notifikasi, value angka besar seperti saldo, items baris info) dan image_prompt boleh kosong. labels selalu kosong. hook_text kosong.' }),
  episode('audio_direction', { instruction: 'Tentukan suara narator untuk seri ini (hangat, bercerita, emosional, tempo sedang-cepat ala storytelling TikTok) dan arahan penyampaian dalam bahasa Inggris. Pertahankan suara yang sama dengan part sebelumnya bila ada. Daftarkan pengucapan angka/singkatan (mis. "Rp50.000" -> "lima puluh ribu rupiah", "PHK" -> "pe ha ka").' }),
  VIDEO_WORKFLOW.find((s) => s.key === 'render_video'),
  VIDEO_WORKFLOW.find((s) => s.key === 'qa_video'),
  episode('distribution', { instruction: 'Siapkan caption per platform untuk part ini: sebut "Part N" di judul/caption, hook singkat tanpa spoiler, ajakan follow agar tidak ketinggalan part berikutnya, hashtag relevan (5-8). Rekomendasi waktu posting (WIB, di masa depan): konsisten dengan jadwal part sebelumnya bila ada (seri butuh ritme tetap, mis. tiap hari jam 19:00). Isi affiliate_cta HANYA jika brief menyebut produk affiliate. Caption/title/hashtags TAYANG PUBLIK: tanpa catatan internal. Catatan untuk Director di schedule_reason. Jangan memublikasikan apa pun.' }),
];

/** Target length per video/part. meta.durationMin = 1 | 2 | 3 (Director's choice); default 1 for short videos, 2 for story parts. */
export function durationTarget(taskType, meta = {}) {
  const fallback = taskType === 'animated_video' ? 1 : 2;
  const min = [1, 2, 3].includes(Number(meta?.durationMin)) ? Number(meta.durationMin) : fallback;
  const scenes = { 1: [5, 8], 2: [8, 14], 3: [14, 22] }[min];
  return { min, words: [105 * min, 145 * min], scenes, label: min + ' menit' };
}

export const WORKFLOWS = { animated_video: VIDEO_WORKFLOW, web_build: WEB_BUILD_WORKFLOW, web_update: WEB_UPDATE_WORKFLOW, story_series: STORY_SERIES_WORKFLOW, story_episode: STORY_EPISODE_WORKFLOW };
export const COORDINATOR = { animated_video: 'ethan', web_build: 'arvin', web_update: 'arvin', story_series: 'ethan', story_episode: 'ethan' };

export const stepDef = (taskType, key) => (WORKFLOWS[taskType] || []).find((s) => s.key === key) || null;

export const GATE_LABEL = {
  choose_idea: 'Pilih ide',
  video_review: 'Review video',
  publish: 'Setujui caption & jadwal posting',
  approve_plan: 'Setujui rencana teknis',
  approve_series: 'Setujui rancangan seri',
  web_review: 'Review preview website',
  task_review: 'Review hasil',
};
