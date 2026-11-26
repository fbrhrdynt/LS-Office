import { createPool, migrate, budgetExceeded } from './db.mjs';
import { claim, complete, fail, reapInterrupted } from './engine.mjs';
import { config } from './config.mjs';

/**
 * Shared loop for workers: reap interrupted work on start, claim one job at a time, respect the daily budget,
 * finish the current job on SIGTERM (up to `graceMs`), then exit.
 *  execute(job, { pool, signal }) -> { text, json?, artifact? }
 *  extraLoops: [{ every, fn(pool) }] small background loops (chat replies, housekeeping)
 */
export async function startWorker({ name, executors, execute, paid = true, graceMs = 100000, extraLoops = [] }) {
  const pool = createPool(executors.includes('agent') ? 4 : 2);
  await migrate(pool);
  const reaped = await reapInterrupted(pool, executors);
  if (reaped) console.log(name + ': requeued ' + reaped + ' interrupted job(s)');
  let stopping = false;
  let current = null;
  const controller = new AbortController();
  let budgetWarned = 0;

  const tick = async () => {
    if (stopping || current) return;
    try {
      if (paid) {
        const blocked = await budgetExceeded(pool);
        if (blocked) {
          if (Date.now() - budgetWarned > 600000) { console.warn(name + ': ' + blocked + '; queue untouched'); budgetWarned = Date.now(); }
          return;
        }
      }
      const job = await claim(pool, executors);
      if (!job) return;
      current = (async () => {
        console.log(name + ': start ' + (job.step_key || 'task') + ' ' + job.id);
        try {
          const result = await execute(job, { pool, signal: controller.signal });
          await complete(pool, job, result);
          console.log(name + ': done ' + (job.step_key || 'task') + ' ' + job.id);
        } catch (error) {
          if (stopping && controller.signal.aborted) {
            console.warn(name + ': aborted by shutdown, will resume on restart');
            return;
          }
          console.error(name + ': failed', job.id, error.message);
          await fail(pool, job, error).catch((e) => console.error('fail() error', e.message));
        }
      })();
      await current;
    } catch (error) {
      console.error(name + ': loop error', error.message);
    } finally {
      current = null;
    }
  };

  console.log(name + ' online; executors=' + executors.join(',') + (paid ? '; model=' + config.textModel + '; budget=$' + config.dailyBudgetUsd + '/day' : ''));
  const timer = setInterval(() => void tick(), config.workerPollMs);
  void tick();
  const extra = extraLoops.map(({ every, fn }) => {
    let busy = false;
    return setInterval(async () => {
      if (busy || stopping) return;
      busy = true;
      try { while (!stopping && (await fn(pool))); } catch (e) { console.error(name + ': loop error', e.message); } finally { busy = false; }
    }, every);
  });

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    extra.forEach(clearInterval);
    console.log(name + ': ' + signal + ' received, finishing current job');
    if (current) {
      const timeout = new Promise((r) => setTimeout(r, graceMs));
      await Promise.race([current, timeout]);
      if (current) {
        controller.abort();
        await Promise.race([current, new Promise((r) => setTimeout(r, 5000))]);
      }
    }
    await pool.end().catch(() => {});
    process.exit(0);
  };
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => void shutdown(s));
  return pool;
}
