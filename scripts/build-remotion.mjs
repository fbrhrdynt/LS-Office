// Bundles the Remotion composition once at deploy time; the render worker renders from this folder.
import { bundle } from '@remotion/bundler';
import path from 'node:path';
import { rm } from 'node:fs/promises';

const out = path.resolve(process.argv[2] || 'remotion-build');
await rm(out, { recursive: true, force: true });
const started = Date.now();
await bundle({ entryPoint: path.resolve('remotion/index.ts'), outDir: out, onProgress: () => {} });
console.log('Remotion bundle ready in ' + out + ' (' + ((Date.now() - started) / 1000).toFixed(1) + 's)');
