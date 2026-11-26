/**
 * Platform publishing adapters. Each `start` uploads/creates the post and returns either
 *   { done: true, postId, url }            published immediately, or
 *   { done: false, state }                 still processing; `poll(state)` is called again later.
 * `poll` returns the same shapes, or throws on a permanent failure.
 *
 * Built against the public API docs of each platform; verify once with a real connected account before relying on it.
 */
import { readFile, stat } from 'node:fs/promises';
import { decryptToken, encryptToken } from '../social-oauth.mjs';
import { publicMediaUrl } from './media.mjs';

const GRAPH = () => 'https://graph.facebook.com/' + (process.env.META_GRAPH_API_VERSION || 'v25.0');

async function ok(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error?.code && data.error.code !== 'ok') {
    const msg = data.error?.message || data.error_description || data.error?.code || 'HTTP ' + response.status;
    throw Object.assign(new Error(label + ': ' + String(msg).slice(0, 300)), { status: response.status, data });
  }
  return data;
}

export function fullCaption(job) {
  const tags = (job.hashtags || []).filter((h) => !job.caption?.includes(h)).join(' ');
  return [job.caption || '', tags].filter(Boolean).join('\n\n').slice(0, 2200);
}

/* ------------------------------------------------------------------ token refresh */

export async function accessToken(pool, account) {
  const expiring = account.token_expires_at && new Date(account.token_expires_at).getTime() < Date.now() + 5 * 60000;
  if (!expiring || !account.refresh_token_ciphertext) return decryptToken(account.access_token_ciphertext);
  const refresh = decryptToken(account.refresh_token_ciphertext);
  let token;
  if (account.platform === 'youtube') {
    token = await ok(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }) }), 'Google token refresh');
  } else if (account.platform === 'tiktok') {
    token = await ok(await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }) }), 'TikTok token refresh');
  } else return decryptToken(account.access_token_ciphertext);
  const expires = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null;
  await pool.query('UPDATE social_accounts SET access_token_ciphertext=$2,refresh_token_ciphertext=COALESCE($3,refresh_token_ciphertext),token_expires_at=$4,status=\'connected\',updated_at=now() WHERE id=$1', [account.id, encryptToken(token.access_token), token.refresh_token ? encryptToken(token.refresh_token) : null, expires]);
  return token.access_token;
}

/* ------------------------------------------------------------------ TikTok (Content Posting API, direct post) */

const tiktok = {
  async start({ job, token, file }) {
    const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json; charset=UTF-8' };
    const creator = await ok(await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: auth, body: '{}' }), 'TikTok creator info');
    const options = creator.data?.privacy_level_options || [];
    const privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0] || 'SELF_ONLY';
    const size = (await stat(file)).size;
    const init = await ok(await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ post_info: { title: fullCaption(job), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 }, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }),
    }), 'TikTok init');
    const put = await fetch(init.data.upload_url, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size), 'content-range': `bytes 0-${size - 1}/${size}` }, body: await readFile(file) });
    if (!put.ok) throw new Error('TikTok upload HTTP ' + put.status);
    return { done: false, state: { publishId: init.data.publish_id, privacy } };
  },
  async poll({ token, state }) {
    const s = await ok(await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: state.publishId }) }), 'TikTok status');
    const status = s.data?.status;
    if (status === 'FAILED') throw Object.assign(new Error('TikTok menolak video: ' + (s.data?.fail_reason || 'unknown')), { permanent: true });
    if (status === 'PUBLISH_COMPLETE') {
      const id = (s.data?.publicaly_available_post_id || s.data?.publicly_available_post_id || [])[0];
      return { done: true, postId: id ? String(id) : state.publishId, url: id ? 'https://www.tiktok.com/video/' + id : null, note: state.privacy !== 'PUBLIC_TO_EVERYONE' ? 'Terposting sebagai ' + state.privacy + ' (aplikasi TikTok belum lolos audit)' : '' };
    }
    return { done: false, state };
  },
};

/* ------------------------------------------------------------------ Instagram Reels (Graph API) */

const instagram = {
  async start({ job, token, account }) {
    const c = await ok(await fetch(GRAPH() + '/' + account.external_account_id + '/media', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ media_type: 'REELS', video_url: publicMediaUrl(job.id), caption: fullCaption(job), share_to_feed: 'true', access_token: token }) }), 'Instagram container');
    return { done: false, state: { containerId: c.id } };
  },
  async poll({ token, account, state }) {
    const s = await ok(await fetch(GRAPH() + '/' + state.containerId + '?fields=status_code,status&access_token=' + encodeURIComponent(token)), 'Instagram status');
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw Object.assign(new Error('Instagram gagal memproses video: ' + (s.status || s.status_code)), { permanent: true });
    if (s.status_code !== 'FINISHED') return { done: false, state };
    const p = await ok(await fetch(GRAPH() + '/' + account.external_account_id + '/media_publish', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: state.containerId, access_token: token }) }), 'Instagram publish');
    const link = await fetch(GRAPH() + '/' + p.id + '?fields=permalink&access_token=' + encodeURIComponent(token)).then((r) => r.json()).catch(() => ({}));
    return { done: true, postId: p.id, url: link.permalink || null };
  },
};

/* ------------------------------------------------------------------ Facebook Page video */

const facebook = {
  async start({ job, token, account }) {
    const v = await ok(await fetch(GRAPH() + '/' + account.external_account_id + '/videos', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ file_url: publicMediaUrl(job.id), description: fullCaption(job), title: job.title || '', access_token: token }) }), 'Facebook upload');
    return { done: false, state: { videoId: v.id } };
  },
  async poll({ token, state }) {
    const s = await ok(await fetch(GRAPH() + '/' + state.videoId + '?fields=status,permalink_url&access_token=' + encodeURIComponent(token)), 'Facebook status');
    const phase = s.status?.video_status;
    if (phase === 'error') throw Object.assign(new Error('Facebook gagal memproses video'), { permanent: true });
    if (phase === 'ready') return { done: true, postId: state.videoId, url: s.permalink_url ? 'https://www.facebook.com' + s.permalink_url : null };
    return { done: false, state };
  },
};

/* ------------------------------------------------------------------ YouTube Shorts (resumable upload) */

const youtube = {
  async start({ job, token, file }) {
    const size = (await stat(file)).size;
    const title = (job.title || job.caption || 'Video').replace(/\s+/g, ' ').slice(0, 95);
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
      body: JSON.stringify({ snippet: { title: title.includes('#Shorts') ? title : title + ' #Shorts', description: fullCaption(job), tags: (job.hashtags || []).map((h) => h.replace(/^#/, '')).slice(0, 15), categoryId: '27' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
    });
    if (!init.ok) await ok(init, 'YouTube init');
    const location = init.headers.get('location');
    if (!location) throw new Error('YouTube tidak memberi upload URL');
    const up = await ok(await fetch(location, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: await readFile(file) }), 'YouTube upload');
    return { done: true, postId: up.id, url: 'https://youtube.com/shorts/' + up.id, note: up.status?.privacyStatus !== 'public' ? 'YouTube menyimpan sebagai ' + up.status?.privacyStatus : '' };
  },
  async poll() { throw new Error('unused'); },
};

export const ADAPTERS = { tiktok, instagram, facebook, youtube };
