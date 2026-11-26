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
    template: { type: 'string', enum: ['explainer', 'cards'] },
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
              kind: { type: 'string', enum: ['none', 'list', 'stat', 'compare', 'steps', 'quote'] },
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

export const SCHEMAS = { IDEA_SCHEMA, SCRIPT_SCHEMA, STORYBOARD_SCHEMA, AUDIO_SCHEMA, DISTRIBUTION_SCHEMA, WEB_PLAN_SCHEMA };

const ideas = (kind) => ({
  key: 'ideas', employeeId: 'nadia', executor: 'agent', gate: 'choose_idea', schema: 'IDEA_SCHEMA', webSearch: true,
  title: kind === 'video' ? 'Ide konten & riset' : 'Ide & konsep website',
  instruction: kind === 'video'
    ? 'Riset dan usulkan 3-5 ide video pendek vertikal (TikTok/Reels, 40-70 detik) yang berpotensi viral sesuai brief. Format "explainer" = adegan ilustrasi sinematik ala animasi 3D yang menjelaskan "kenapa/bagaimana" dengan label dan panah; format "cards" = motion graphics kartu UI gelap, daftar Top-N, angka yang naik. Tiap ide wajib punya hook 2 detik yang kuat, fakta kunci yang benar-benar bisa diverifikasi, dan sumber nyata (URL) dari web search. Nilai juga kecocokan untuk affiliate. Jangan menulis naskah.'
    : 'Riset dan usulkan 3-5 konsep website sesuai brief: target pengguna, masalah yang diselesaikan, fitur inti, referensi nyata, dan alasan. Isi field format dengan "explainer" untuk website konten/landing dan "cards" untuk aplikasi/dashboard. Jangan menulis kode.',
});

export const VIDEO_WORKFLOW = [
  ideas('video'),
  { key: 'script', employeeId: 'felix', executor: 'agent', schema: 'SCRIPT_SCHEMA', title: 'Naskah', instruction: 'Tulis naskah voice-over berbahasa Indonesia yang natural dan cepat untuk ide terpilih: 95-135 kata total (45-60 detik), 5-8 adegan. Field spoken HANYA berisi kata yang diucapkan narator: tanpa label (Visual/Catatan/Hook/CTA), tanpa arahan kamera, tanpa tanda kurung, tanpa timestamp. Arahan visual tulis di visual_note. Kalimat pendek, hook kuat di adegan 1 (sama dengan hook_line), penjelasan runtut, insight/twist, penutup + CTA singkat (follow, atau cek link di bio bila ada affiliate). Hanya pakai fakta dari riset Nadia. Tulis angka dan istilah apa adanya (Maya yang mengatur pengucapan).' },
  { key: 'storyboard', employeeId: 'ethan', executor: 'agent', schema: 'STORYBOARD_SCHEMA', title: 'Storyboard & visual', instruction: 'Ubah naskah Felix menjadi storyboard produksi. Field narration = SALIN PERSIS field spoken dari naskah Felix (boleh dipecah/digabung per adegan, jangan menambah, mengurangi, atau mengubah kata). visual_note Felix dipakai untuk image_prompt dan label, BUKAN narasi. hook_text = hook_line Felix (maks 10 kata). Template mengikuti format ide terpilih. Untuk "explainer": tiap adegan punya image_prompt sinematik (gaya render 3D stylized, karakter konsisten sesuai character_bible, komposisi vertikal, tanpa teks) dan 0-2 label penunjuk (x,y 0-1) berbahasa Indonesia, maksimal 3 kata, di luar area tengah-bawah layar (y < 0.5 atau y > 0.75) karena area itu untuk caption. Untuk "cards": gunakan card (list/stat/compare/steps/quote) di hampir semua adegan; image_prompt boleh kosong. 5-9 adegan, maksimal 3 label per adegan, maksimal 6 item per card.' },
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

export const WORKFLOWS = { animated_video: VIDEO_WORKFLOW, web_build: WEB_BUILD_WORKFLOW, web_update: WEB_UPDATE_WORKFLOW };
export const COORDINATOR = { animated_video: 'ethan', web_build: 'arvin', web_update: 'arvin' };

export const stepDef = (taskType, key) => (WORKFLOWS[taskType] || []).find((s) => s.key === key) || null;

export const GATE_LABEL = {
  choose_idea: 'Pilih ide',
  video_review: 'Review video',
  publish: 'Setujui caption & jadwal posting',
  approve_plan: 'Setujui rencana teknis',
  web_review: 'Review preview website',
  task_review: 'Review hasil',
};
