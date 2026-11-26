/** Human-readable text for structured step outputs (shown in the app and Telegram). */
export function formatOutput(key, j) {
  if (key === 'ideas') {
    return j.ideas.map((x, i) => [
      `IDE ${i + 1} · ${x.title} [${x.format === 'cards' ? 'motion cards' : x.format === 'story' ? 'cerita bersambung' : 'explainer'}]`,
      `Hook: ${x.hook}`,
      `Angle: ${x.angle}`,
      `Kenapa jalan: ${x.why_it_works}`,
      x.key_facts.length ? 'Fakta kunci:\n' + x.key_facts.map((f) => '  • ' + f).join('\n') : '',
      x.sources.length ? 'Sumber:\n' + x.sources.map((s) => `  - ${s.title} — ${s.url}`).join('\n') : 'Sumber: -',
      `Affiliate: ${x.affiliate_fit}`,
    ].filter(Boolean).join('\n')).join('\n\n') + `\n\nREKOMENDASI NADIA: ${j.recommendation}`;
  }
  if (key === 'series_plan') {
    return [`${j.title}`, j.logline, `Tone: ${j.tone}`, '', 'TOKOH:', ...j.characters.map((c) => `• ${c.name} — ${c.role}. ${c.personality}. Arc: ${c.arc}`), '', 'PART:', ...j.episodes.map((e) => `Part ${e.part}: ${e.title}\n  ${e.summary}\n  Akhir: ${e.cliffhanger}`)].join('\n');
  }
  if (key === 'character_design') {
    return [`Gaya: ${j.visual_style}`, '', ...j.characters.map((c) => `• ${c.name}: ${c.appearance}`), '', 'Lokasi:', ...j.locations.map((l) => `• ${l.name}: ${l.description}`)].join('\n');
  }
  if (key === 'script') {
    return [`${j.title} · ${j.word_count} kata`, `Hook: ${j.hook_line}`, '', ...j.scenes.map((x, i) => `Adegan ${i + 1}: ${x.spoken}\n  (visual: ${x.visual_note})`)].join('\n');
  }
  if (key === 'storyboard') {
    return [`${j.title} · template ${j.template}`, `Hook: ${j.hook_text}`, `Gaya visual: ${j.visual_style}`, `Karakter: ${j.character_bible}`, '',
      ...j.scenes.map((s, i) => `Adegan ${i + 1}: "${s.narration}"` +
        (s.image_prompt ? `\n  Visual: ${s.image_prompt}` : '') +
        (s.labels.length ? `\n  Label: ${s.labels.map((l) => l.text).join(', ')}` : '') +
        (s.card.kind !== 'none' ? `\n  Kartu ${s.card.kind}: ${s.card.heading}${s.card.items.length ? ' — ' + s.card.items.join(' | ') : ''}${s.card.value ? ' = ' + s.card.value : ''}` : ''))].join('\n');
  }
  if (key === 'audio_direction') {
    return [`Suara: ${j.voice}`, `Arahan: ${j.instructions}`, j.pronunciations.length ? 'Pengucapan:\n' + j.pronunciations.map((p) => `  ${p.written} → ${p.spoken}`).join('\n') : '', j.notes].filter(Boolean).join('\n');
  }
  if (key === 'distribution') {
    return [`Jadwal usulan: ${j.recommended_time} WIB — ${j.schedule_reason}`, '',
      ...j.posts.map((p) => `${p.platform.toUpperCase()} · ${p.title}\n${p.caption}\n${p.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ')}`),
      j.affiliate_cta ? `\nCTA affiliate: ${j.affiliate_cta}` : ''].join('\n');
  }
  if (key === 'plan') {
    return [j.summary, `Stack: ${j.stack}`, 'Halaman:\n' + j.pages.map((p) => `  ${p.path} — ${p.purpose}`).join('\n'), 'Fitur:\n' + j.features.map((f) => '  • ' + f).join('\n'), 'Acceptance criteria:\n' + j.acceptance_criteria.map((f) => '  ✓ ' + f).join('\n'), j.risks.length ? 'Risiko:\n' + j.risks.map((f) => '  ! ' + f).join('\n') : ''].filter(Boolean).join('\n\n');
  }
  return JSON.stringify(j, null, 2);
}
