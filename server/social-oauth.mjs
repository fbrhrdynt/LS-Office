import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const required = (value, name) => {
  if (!value) throw new Error('OAuth configuration missing: ' + name);
  return value;
};
const form = (values) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
const safeJson = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Provider request failed (' + response.status + '): ' + String(data.error_description || data.error?.message || data.error || 'unknown error').slice(0, 300));
  return data;
};

export function encryptToken(value) {
  const key = Buffer.from(required(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY, 'SOCIAL_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptToken(value) {
  const key = Buffer.from(required(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY, 'SOCIAL_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const [iv, tag, encrypted] = String(value).split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !encrypted) throw new Error('Invalid encrypted token format');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function oauthConfiguration(platform) {
  const meta = ['instagram', 'facebook'].includes(platform);
  const configured = meta
    ? Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI)
    : platform === 'tiktok'
      ? Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI)
      : platform === 'youtube'
        ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
        : false;
  return configured;
}

export async function buildAuthorizationUrl(platform, state) {
  if (['instagram', 'facebook'].includes(platform)) {
    const params = form({
      client_id: required(process.env.META_APP_ID, 'META_APP_ID'),
      redirect_uri: required(process.env.META_REDIRECT_URI, 'META_REDIRECT_URI'),
      response_type: 'code',
      state,
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'
    });
    return 'https://www.facebook.com/' + (process.env.META_GRAPH_API_VERSION || 'v25.0') + '/dialog/oauth?' + params;
  }
  if (platform === 'tiktok') {
    const params = form({
      client_key: required(process.env.TIKTOK_CLIENT_KEY, 'TIKTOK_CLIENT_KEY'),
      response_type: 'code',
      scope: 'user.info.basic,user.info.profile,video.publish',
      redirect_uri: required(process.env.TIKTOK_REDIRECT_URI, 'TIKTOK_REDIRECT_URI'),
      state
    });
    return 'https://www.tiktok.com/v2/auth/authorize/?' + params;
  }
  if (platform === 'youtube') {
    const params = form({
      client_id: required(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID'),
      redirect_uri: required(process.env.GOOGLE_REDIRECT_URI, 'GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }
  throw new Error('Unsupported social platform');
}

async function exchange(platform, code) {
  if (['instagram', 'facebook'].includes(platform)) {
    const response = await fetch('https://graph.facebook.com/' + (process.env.META_GRAPH_API_VERSION || 'v25.0') + '/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: required(process.env.META_APP_ID, 'META_APP_ID'), client_secret: required(process.env.META_APP_SECRET, 'META_APP_SECRET'), redirect_uri: required(process.env.META_REDIRECT_URI, 'META_REDIRECT_URI'), code })
    });
    const short = await safeJson(response);
    const longResponse = await fetch('https://graph.facebook.com/' + (process.env.META_GRAPH_API_VERSION || 'v25.0') + '/oauth/access_token?' + form({ grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: short.access_token }));
    const long = await safeJson(longResponse);
    const token = long.access_token || short.access_token;
    const pagesResponse = await fetch('https://graph.facebook.com/' + (process.env.META_GRAPH_API_VERSION || 'v25.0') + '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=' + encodeURIComponent(token));
    const pages = await safeJson(pagesResponse);
    const accounts = [];
    for (const page of pages.data || []) {
      if (page.id && page.name && page.access_token) accounts.push({ platform: 'facebook', id: page.id, name: page.name, accessToken: page.access_token, refreshToken: null, expiresIn: long.expires_in || short.expires_in, scopes: ['pages_show_list','pages_read_engagement','pages_manage_posts'], metadata: { pageId: page.id } });
      const instagram = page.instagram_business_account;
      if (instagram?.id) accounts.push({ platform: 'instagram', id: instagram.id, name: instagram.username || page.name, accessToken: page.access_token, refreshToken: null, expiresIn: long.expires_in || short.expires_in, scopes: ['instagram_basic','instagram_content_publish','pages_show_list'], metadata: { pageId: page.id } });
    }
    if (!accounts.length) throw new Error('Meta authorization succeeded, but no accessible Facebook Page was found. Link an Instagram Professional account to a Facebook Page and grant Page permissions.');
    return accounts;
  }
  if (platform === 'tiktok') {
    const token = await safeJson(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
      body: form({ client_key: required(process.env.TIKTOK_CLIENT_KEY, 'TIKTOK_CLIENT_KEY'), client_secret: required(process.env.TIKTOK_CLIENT_SECRET, 'TIKTOK_CLIENT_SECRET'), code, grant_type: 'authorization_code', redirect_uri: required(process.env.TIKTOK_REDIRECT_URI, 'TIKTOK_REDIRECT_URI') })
    }));
    const profile = await safeJson(await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers: { authorization: 'Bearer ' + token.access_token } }));
    const user = profile.data?.user;
    if (!user?.open_id) throw new Error('TikTok profile response did not include open_id');
    return [{ platform, id: user.open_id, name: user.display_name || user.username || user.open_id, accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, scopes: String(token.scope || '').split(',').filter(Boolean) }];
  }
  if (platform === 'youtube') {
    const token = await safeJson(await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ code, client_id: required(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID'), client_secret: required(process.env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET'), redirect_uri: required(process.env.GOOGLE_REDIRECT_URI, 'GOOGLE_REDIRECT_URI'), grant_type: 'authorization_code' })
    }));
    const profile = await safeJson(await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: 'Bearer ' + token.access_token } }));
    const channels = await safeJson(await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: 'Bearer ' + token.access_token } }));
    const channel = channels.items?.[0];
    const id = channel?.id || profile.sub;
    const name = channel?.snippet?.title || profile.name || profile.email || id;
    if (!id) throw new Error('Google account identity could not be resolved');
    return [{ platform, id, name, accessToken: token.access_token, refreshToken: token.refresh_token || null, expiresIn: token.expires_in, scopes: String(token.scope || '').split(' ').filter(Boolean) }];
  }
  throw new Error('Unsupported social platform');
}

export async function completeOAuth(pool, platform, code, state, sessionHash) {
  const stateHash = hash(state);
  const consumed = await pool.query(
    'DELETE FROM social_oauth_states WHERE state_hash=$1 AND platform=$2 AND session_hash=$3 AND expires_at>now() RETURNING id',
    [stateHash, platform, sessionHash]
  );
  if (!consumed.rowCount) throw new Error('OAuth state invalid, expired, or session changed. Start connection again.');
  const accounts = await exchange(platform, code);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const account of accounts) {
      const expiresAt = account.expiresIn ? new Date(Date.now() + Number(account.expiresIn) * 1000) : null;
      await client.query(
        `INSERT INTO social_accounts(platform,external_account_id,account_name,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,scopes,status,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,'connected',$8::jsonb)
         ON CONFLICT(platform,external_account_id) DO UPDATE SET account_name=EXCLUDED.account_name,access_token_ciphertext=EXCLUDED.access_token_ciphertext,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,token_expires_at=EXCLUDED.token_expires_at,scopes=EXCLUDED.scopes,status='connected',metadata=EXCLUDED.metadata,updated_at=now()`,
        [account.platform, account.id, account.name, encryptToken(account.accessToken), account.refreshToken ? encryptToken(account.refreshToken) : null, expiresAt, account.scopes, JSON.stringify(account.metadata || { provider: platform })]
      );
    }
    await client.query('COMMIT');
    return accounts.map(({ platform: p, id, name }) => ({ platform: p, accountId: id, accountName: name }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
