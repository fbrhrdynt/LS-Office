import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { config } from './config.mjs';
import PERSONNEL from '../../shared/personnel.json' with { type: 'json' };

const { Pool } = pg;

export function createPool(max = 5) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: config.databaseUrl, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  pool.on('error', (error) => console.error('pg pool error', error.message));
  return pool;
}

export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/**
 * Versioned migrations, applied once each, under an advisory lock so the API and workers can start together.
 * Existing installs (created before versioning) run 001 again; it is idempotent.
 */
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(74210315)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(MIGRATIONS)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
        await client.query('COMMIT');
        console.log('migration applied', file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error('Migration ' + file + ' failed: ' + error.message);
      }
    }
    for (const e of PERSONNEL) {
      await client.query(
        `INSERT INTO employees(id,key,name,role,department,manager_key,system_prompt) VALUES($1,$1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,department=EXCLUDED.department,manager_key=EXCLUDED.manager_key,system_prompt=EXCLUDED.system_prompt,active=true,updated_at=now()`,
        [e.key, e.name, e.role, e.department, e.managerKey, e.prompt]
      );
    }
    await client.query('UPDATE employees SET active=false,updated_at=now() WHERE id <> ALL($1::text[]) AND active', [PERSONNEL.map((e) => e.key)]);
    await client.query('DELETE FROM director_sessions WHERE expires_at < now()');
    await client.query('DELETE FROM social_oauth_states WHERE expires_at < now()');
  } finally {
    await client.query('SELECT pg_advisory_unlock(74210315)').catch(() => {});
    client.release();
  }
}

export async function getSetting(pool, key, fallback = null) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r.rowCount ? r.rows[0].value : fallback;
}

export async function setSetting(pool, key, value) {
  await pool.query('INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()', [key, JSON.stringify(value)]);
}

/** Spend and run counters for today (office timezone). */
export async function todayUsage(pool) {
  const r = await pool.query(
    `SELECT
       (SELECT COALESCE(sum(cost_usd),0)::float FROM usage_ledger WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS cost,
       (SELECT count(*)::int FROM task_runs WHERE started_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS runs`,
    [config.timezone]
  );
  return r.rows[0];
}

export async function budgetExceeded(pool) {
  const u = await todayUsage(pool);
  if (u.runs >= config.maxDailyRuns) return 'Batas run harian tercapai (' + u.runs + '/' + config.maxDailyRuns + ')';
  if (u.cost >= config.dailyBudgetUsd) return 'Budget harian tercapai (estimasi $' + u.cost.toFixed(2) + ' / $' + config.dailyBudgetUsd + ')';
  return null;
}
