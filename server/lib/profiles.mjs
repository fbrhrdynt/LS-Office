/**
 * Account profiles: who an account's content is for, its tone and what it must never do. The profile chosen for a task
 * (default profile when none was chosen) is part of every creative step's context, so ideas, scripts and captions all
 * follow the same voice. Recent ideas of the same profile are listed so Nadia does not repeat herself.
 */
const FIELDS = ['name', 'handle', 'topic', 'audience', 'tone', 'forbidden', 'notes'];
const LIMIT = { name: 80, handle: 80, topic: 600, audience: 600, tone: 600, forbidden: 800, notes: 1500 };

export async function listProfiles(db) {
  return (await db.query('SELECT * FROM content_profiles ORDER BY is_default DESC, name')).rows;
}

export async function defaultProfileId(db) {
  return (await db.query('SELECT id FROM content_profiles WHERE is_default LIMIT 1')).rows[0]?.id ?? null;
}

function clean(input) {
  const out = {};
  for (const f of FIELDS) out[f] = String(input?.[f] ?? '').trim().slice(0, LIMIT[f]);
  out.handle = out.handle.replace(/^@+/, '');
  if (!out.name) throw Object.assign(new Error('Nama profil wajib diisi'), { status: 400 });
  return out;
}

export async function saveProfile(db, id, input) {
  const p = clean(input);
  const makeDefault = Boolean(input?.is_default);
  const vals = FIELDS.map((f) => p[f]);
  let row;
  if (id) {
    row = (await db.query(`UPDATE content_profiles SET ${FIELDS.map((f, i) => f + '=$' + (i + 2)).join(',')},updated_at=now() WHERE id=$1 RETURNING *`, [id, ...vals])).rows[0];
    if (!row) throw Object.assign(new Error('Profil tidak ditemukan'), { status: 404 });
  } else {
    row = (await db.query(`INSERT INTO content_profiles(${FIELDS.join(',')}) VALUES(${FIELDS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals)).rows[0];
  }
  // The first profile becomes the default automatically.
  const hasDefault = await defaultProfileId(db);
  if (makeDefault || !hasDefault) {
    await db.query('UPDATE content_profiles SET is_default=false WHERE is_default AND id<>$1', [row.id]);
    row = (await db.query('UPDATE content_profiles SET is_default=true WHERE id=$1 RETURNING *', [row.id])).rows[0];
  }
  return row;
}

export async function deleteProfile(db, id) {
  const r = await db.query('DELETE FROM content_profiles WHERE id=$1 RETURNING is_default', [id]);
  if (r.rows[0]?.is_default) await db.query('UPDATE content_profiles SET is_default=true WHERE id=(SELECT id FROM content_profiles ORDER BY id LIMIT 1)');
  return r.rowCount > 0;
}

export function profileText(p) {
  if (!p) return '';
  const line = (label, v) => (v ? '\n' + label + ': ' + v : '');
  return '### PROFIL AKUN (wajib diikuti di setiap tahap)\nAkun: ' + p.name + (p.handle ? ' (@' + p.handle + ')' : '') +
    line('Topik', p.topic) + line('Penonton', p.audience) + line('Gaya bahasa', p.tone) + line('Dilarang', p.forbidden) + line('Catatan', p.notes);
}

/** Titles of ideas this account already produced (newest first), so new ideas are not near-duplicates. */
export async function recentIdeaTitles(db, taskId, profileId, limit = 15) {
  const r = await db.query(
    `SELECT s.output_json, s.decision, t.task_type FROM workflow_steps s JOIN tasks t ON t.id=s.task_id
     WHERE s.step_key='ideas' AND s.status='completed' AND s.decision IS NOT NULL AND t.id<>$1
       AND t.task_type IN ('animated_video','story_series') AND t.status NOT IN ('cancelled','rejected')
       AND coalesce(t.meta->>'profileId','') = coalesce($2::text,'')
     ORDER BY s.finished_at DESC NULLS LAST LIMIT $3`,
    [taskId, profileId == null ? null : String(profileId), limit]
  );
  return r.rows.map((x) => {
    const d = x.decision || {};
    if (d.customIdea) return String(d.customIdea).split('\n')[0].slice(0, 90);
    const idea = (x.output_json?.ideas || [])[Number.isInteger(d.ideaIndex) ? d.ideaIndex : 0];
    return idea?.title || null;
  }).filter(Boolean);
}
