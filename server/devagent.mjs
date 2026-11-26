/**
 * Web Dev agent. Runs as the unprivileged user `ls-office-dev` (no sudo, no access to /opt/ls-office or /etc/ls-office).
 *  implement (Nathan): Claude Code headless edits an isolated git worktree and commits on a task branch.
 *  qa_web (Daren):     runs the Director-configured install/build/test commands and publishes a Director-only preview.
 *  release (Arvin):    after Director approval, merges the branch into the default branch (and pushes if a remote is set),
 *                      or publishes a new static site under /sites/<slug>/.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, cp, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startWorker } from './lib/runner.mjs';
import { config } from './lib/config.mjs';
import { workContext } from './lib/engine.mjs';

const ROOT = config.devDataRoot;
const exists = (p) => access(p).then(() => true, () => false);
const tail = (s, n = 3000) => (s.length > n ? '…' + s.slice(-n) : s);

function sh(cmd, args, { cwd, timeoutMs = 600000, env = {}, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', CI: '1' }, signal, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (c) => { out = (out + c).slice(-200000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    if (input) { child.stdin.write(input); child.stdin.end(); }
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
const shell = (line, opts) => sh('bash', ['-lc', line], opts);
async function must(cmd, args, opts, label) {
  const r = await sh(cmd, args, opts);
  if (r.code !== 0) throw new Error((label || cmd) + ' gagal:\n' + tail(r.out, 1500));
  return r.out;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'web';

/** Resolves (and for new websites, creates) the project and the task's worktree. */
async function workspace(pool, job) {
  let p = job.project_id ? (await pool.query('SELECT * FROM dev_projects WHERE id=$1', [job.project_id])).rows[0] : null;
  if (!p) {
    let slug = slugify(job.title);
    if ((await pool.query('SELECT 1 FROM dev_projects WHERE slug=$1', [slug])).rowCount) slug = slug.slice(0, 30) + '-' + job.id.slice(0, 5);
    p = (await pool.query("INSERT INTO dev_projects(slug,name,install_cmd,build_cmd,preview_dir,notes) VALUES($1,$2,'npm install --no-audit --no-fund','npm run build','dist','Website baru dari LSAI Office. Vite, base relatif.') RETURNING *", [slug, job.title.slice(0, 120)])).rows[0];
    await pool.query('UPDATE tasks SET project_id=$2 WHERE id=$1', [job.id, p.id]);
  }
  const repo = path.join(ROOT, 'projects', p.slug, 'repo');
  const branch = 'lsai/' + job.id.slice(0, 8);
  const tree = path.join(ROOT, 'work', job.id);
  await mkdir(path.dirname(repo), { recursive: true });
  if (!(await exists(path.join(repo, '.git')))) {
    if (p.repo_url) await must('git', ['clone', '--quiet', p.repo_url, repo], { timeoutMs: 300000 }, 'git clone');
    else {
      await mkdir(repo, { recursive: true });
      await must('git', ['init', '-q', '-b', p.default_branch], { cwd: repo });
      await writeFile(path.join(repo, 'README.md'), '# ' + p.name + '\n\nDibuat oleh tim Web Dev LSAI Office.\n');
      await writeFile(path.join(repo, '.gitignore'), 'node_modules\ndist\n');
      await must('git', ['add', '-A'], { cwd: repo });
      await must('git', ['-c', 'user.name=LSAI Arvin', '-c', 'user.email=arvin@lsai.local', 'commit', '-qm', 'chore: init project'], { cwd: repo });
    }
  } else if (p.repo_url) {
    await sh('git', ['fetch', '--quiet', 'origin'], { cwd: repo, timeoutMs: 120000 });
  }
  if (!(await exists(tree))) {
    const base = p.repo_url ? 'origin/' + p.default_branch : p.default_branch;
    await sh('git', ['branch', '-D', branch], { cwd: repo });
    await must('git', ['worktree', 'add', '-q', '-b', branch, tree, base], { cwd: repo }, 'git worktree');
  }
  return { p, repo, tree, branch };
}

async function implement(job, { pool, signal }) {
  const { p, tree, branch } = await workspace(pool, job);
  const context = await workContext(pool, job);
  const prompt = [
    'Kamu Nathan, Full-stack Developer di tim Web Dev LSAI Office. Kerjakan perubahan berikut langsung di repository ini (direktori kerja saat ini).',
    context,
    'ATURAN:',
    '- Kerjakan hanya yang diminta rencana Arvin / brief Director. Jangan menyentuh file di luar repository ini.',
    '- Jangan push, jangan deploy, jangan mengubah konfigurasi git remote, jangan menulis secret.',
    p.repo_url ? '- Ikuti gaya kode yang sudah ada.' : '- Ini website baru: pakai Vite (npm create tidak tersedia; tulis package.json sendiri), `base: "./"` di vite.config supaya bisa dibuka dari sub-path, build ke folder dist. Buat tampilan rapi dan responsif (375px dan desktop).',
    '- Pastikan `' + (p.build_cmd || 'npm run build') + '` berhasil sebelum selesai.',
    '- Akhiri dengan ringkasan singkat (bahasa Indonesia): apa yang diubah, file utama, cara mengetes, dan hal yang belum selesai.',
  ].join('\n\n');
  const allowed = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm install:*)', 'Bash(npm ci:*)', 'Bash(npm run:*)', 'Bash(npm test:*)', 'Bash(npx vite:*)', 'Bash(npx tsc:*)', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(mkdir:*)'];
  const r = await sh(config.claudeBin, ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', String(config.devMaxTurns), '--allowedTools', allowed.join(','), '--disallowedTools', 'Bash(git push:*),Bash(git remote:*),Bash(sudo:*),Bash(curl:*),Bash(wget:*),WebFetch'], { cwd: tree, timeoutMs: 45 * 60000, signal, input: prompt });
  let result = null;
  try { result = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* not json */ }
  if (r.code !== 0 || !result || result.is_error) throw new Error('Claude Code gagal: ' + tail(result?.result || r.out, 1200));
  await must('git', ['add', '-A'], { cwd: tree });
  const changed = (await sh('git', ['diff', '--cached', '--stat'], { cwd: tree })).out.trim();
  if (changed) await must('git', ['-c', 'user.name=LSAI Nathan', '-c', 'user.email=nathan@lsai.local', 'commit', '-qm', (job.revision_count ? 'fix: revisi Director - ' : 'feat: ') + job.title.slice(0, 60)], { cwd: tree });
  const cost = Number(result.total_cost_usd || 0);
  if (cost) await pool.query("INSERT INTO usage_ledger(task_id,run_id,step_key,kind,model,units,cost_usd) VALUES($1,$2,'implement','claude','claude-code',$3,$4)", [job.id, job.runId, JSON.stringify({ turns: result.num_turns, durationMs: result.duration_ms }), cost]);
  return { text: 'Branch: ' + branch + '\n\n' + String(result.result || '').trim() + '\n\nPerubahan:\n' + (changed || 'tidak ada perubahan file') };
}

async function qa(job, { pool, signal }) {
  const { p, tree, branch } = await workspace(pool, job);
  const report = [];
  for (const [label, cmd] of [['Install', p.install_cmd], ['Build', p.build_cmd], ['Test', p.test_cmd]]) {
    if (!cmd) { report.push('– ' + label + ': tidak dikonfigurasi'); continue; }
    const r = await shell(cmd, { cwd: tree, timeoutMs: 20 * 60000, signal });
    report.push((r.code === 0 ? '✓ ' : '✗ ') + label + ' (' + cmd + ')');
    if (r.code !== 0) throw new Error('QA gagal di ' + label + ':\n' + report.join('\n') + '\n\n' + tail(r.out, 1500));
  }
  let preview = 'tidak ada (preview_dir belum diatur)';
  if (p.preview_dir) {
    const src = path.join(tree, p.preview_dir);
    if (!(await exists(src))) throw new Error('Folder hasil build "' + p.preview_dir + '" tidak ditemukan');
    const dst = path.join(ROOT, 'previews', job.id);
    await rm(dst, { recursive: true, force: true });
    await mkdir(path.dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: true });
    preview = config.publicBaseUrl + '/preview/' + job.id + '/';
  }
  const base = p.repo_url ? 'origin/' + p.default_branch : p.default_branch;
  const stat = (await sh('git', ['diff', '--stat', base + '...' + branch], { cwd: tree })).out.trim();
  const log = (await sh('git', ['log', '--oneline', base + '..' + branch], { cwd: tree })).out.trim();
  return { text: 'QA PASS\n' + report.join('\n') + '\n\nPreview (khusus Director): ' + preview + '\n\nCommit:\n' + (log || '-') + '\n\nDiff:\n' + tail(stat, 2500) };
}

async function release(job, { pool }) {
  const { p, repo, tree, branch } = await workspace(pool, job);
  const lines = [];
  if (p.repo_url) {
    await must('git', ['fetch', '--quiet', 'origin'], { cwd: repo, timeoutMs: 120000 }, 'git fetch');
    await must('git', ['checkout', '-q', p.default_branch], { cwd: repo });
    await must('git', ['reset', '-q', '--hard', 'origin/' + p.default_branch], { cwd: repo });
    await must('git', ['-c', 'user.name=LSAI Arvin', '-c', 'user.email=arvin@lsai.local', 'merge', '--no-ff', '-qm', 'Merge ' + branch + ': ' + job.title.slice(0, 60), branch], { cwd: repo }, 'git merge');
    const push = await sh('git', ['push', 'origin', p.default_branch], { cwd: repo, timeoutMs: 120000 });
    lines.push(push.code === 0 ? '✓ Di-merge ke ' + p.default_branch + ' dan di-push ke ' + p.repo_url : '✗ Merge lokal berhasil, push gagal (cek deploy key ls-office-dev):\n' + tail(push.out, 600));
    lines.push('Deploy production proyek ini mengikuti pipeline proyeknya sendiri (CI/CD atau manual).');
  } else {
    await must('git', ['checkout', '-q', p.default_branch], { cwd: repo });
    await must('git', ['-c', 'user.name=LSAI Arvin', '-c', 'user.email=arvin@lsai.local', 'merge', '--no-ff', '-qm', 'Merge ' + branch + ': ' + job.title.slice(0, 60), branch], { cwd: repo }, 'git merge');
    const src = path.join(tree, p.preview_dir || 'dist');
    const dst = path.join(ROOT, 'sites', p.slug);
    await rm(dst + '.next', { recursive: true, force: true });
    await cp(src, dst + '.next', { recursive: true });
    await rm(dst, { recursive: true, force: true });
    await cp(dst + '.next', dst, { recursive: true });
    await rm(dst + '.next', { recursive: true, force: true });
    lines.push('✓ Website terbit: ' + config.publicBaseUrl + '/sites/' + p.slug + '/');
    lines.push('Untuk domain sendiri, arahkan DNS ke VPS lalu minta Daren/Arvin menyiapkan vhost.');
  }
  await sh('git', ['worktree', 'remove', '--force', tree], { cwd: repo });
  await rm(path.join(ROOT, 'previews', job.id), { recursive: true, force: true });
  return { text: lines.join('\n') };
}

await mkdir(path.join(ROOT, 'work'), { recursive: true });
await startWorker({
  name: 'ls-office-devagent',
  executors: ['devagent'],
  paid: false,
  graceMs: 30000,
  execute: (job, opts) => (job.step_key === 'implement' ? implement(job, opts) : job.step_key === 'qa_web' ? qa(job, opts) : release(job, opts)),
});
