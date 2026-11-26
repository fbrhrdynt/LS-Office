import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { encryptToken, decryptToken, oauthConfiguration } = await import('../server/social-oauth.mjs');

const secret = 'access-token-with-unicode-✓';
const encrypted = encryptToken(secret);
assert.notEqual(encrypted, secret);
assert.equal(decryptToken(encrypted), secret);
assert.throws(() => decryptToken(encrypted + 'tampered'), /Unsupported state|authenticate|Invalid encrypted token format/);

delete process.env.META_APP_ID;
delete process.env.META_APP_SECRET;
delete process.env.META_REDIRECT_URI;
assert.equal(oauthConfiguration('facebook'), false);

process.env.META_APP_ID = 'test-app';
process.env.META_APP_SECRET = 'test-secret';
process.env.META_REDIRECT_URI = 'https://example.test/callback';
assert.equal(oauthConfiguration('instagram'), true);
assert.equal(oauthConfiguration('facebook'), true);

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
assert.throws(() => encryptToken('x'), /32-byte/);
console.log('Social OAuth crypto/config tests passed');
