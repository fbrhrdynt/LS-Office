import { createHmac } from 'node:crypto';
import { config, mediaSigningKey } from './config.mjs';

export const signMedia = (jobId, exp) => createHmac('sha256', mediaSigningKey()).update(jobId + '.' + exp).digest('base64url');

/** Short-lived public URL for one publication job's video (platforms that pull the file by URL). */
export function publicMediaUrl(jobId, hours = 6) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `${config.publicBaseUrl}/api/public/media/${jobId}?exp=${exp}&sig=${signMedia(jobId, exp)}`;
}
