// Video render worker: separate service with its own memory/CPU limits so a render never blocks the text queue.
import { startWorker } from './lib/runner.mjs';
import { produceVideo } from './video/produce.mjs';

await startWorker({
  name: 'ls-office-render',
  executors: ['render'],
  execute: produceVideo,
  graceMs: 15000,
});
