export type Employee = { id: string; key: string; name: string; role: string; department: string; managerKey: string | null; summary: string; color: string; room: string; desk: { x: number; z: number } | null; schedule?: import('../office').Schedule };
export type CurrentStep = { key: string; title: string; status: string; assignee: string | null } | null;
export type TaskRow = { id: string; title: string; status: string; task_type: string; priority: string; assignee_id: string; assignee_name: string; created_at: string; updated_at: string; revision_count: number; current_step: CurrentStep; steps_total: number; steps_done: number };
export type Step = { id: string; step_order: number; step_key: string; title: string; status: string; requires_approval: boolean; output_text: string | null; output_json: any; decision: any; revision_notes: string | null; attempts: number; assignee_id: string | null; assignee_name: string | null; executor: string; started_at: string | null; finished_at: string | null };
export type Run = { id: string; status: string; output_text: string | null; error_message: string | null; started_at: string; finished_at: string | null; cost: number; executor: string | null; step_id: string | null };
export type PubJob = { id: string; platform: string; status: string; caption: string | null; hashtags: string[]; title: string | null; scheduled_at: string | null; post_url: string | null; error_message: string | null; attempts: number; published_at: string | null };
export type TaskDetail = { task: TaskRow & { instruction: string; acceptance_criteria: string | null; meta: any; has_video: boolean; artifact_name: string | null; revision_notes: string | null; project_id: string | null }; runs: Run[]; workflowSteps: Step[]; publicationJobs: PubJob[]; events: { type: string; payload: any; created_at: string }[]; cost: number; project: { id: string; slug: string; name: string } | null };
export type Notification = { id: number; taskId: string | null; employeeId: string | null; kind: string; title: string; body: string; action: any; createdAt: string; readAt: string | null };
export type Overview = { counts: Record<string, number>; recent: { id: number; taskId: string; type: string; createdAt: string; title?: string }[]; usage: { cost: number; runs: number; budget: number; maxRuns: number }; unread: number };
export type Message = { id: number; sender: string; body: string; channel: string; status: string; meta: any; created_at: string };
export type Project = { id: string; slug: string; name: string; repo_url: string | null; default_branch: string; install_cmd: string | null; build_cmd: string | null; test_cmd: string | null; preview_dir: string | null; notes: string | null; tasks: number };
export type SocialPlatform = { platform: string; configured: boolean; accounts: { id: string; accountName: string; status: string; tokenExpiresAt: string | null }[]; requirements: string[] };
export type OfficeEntry = { state: 'working' | 'waiting' | 'blocked' | 'available'; taskId?: string; title?: string; step?: string; since?: string; queued?: number };

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch('/api' + path, { ...rest, credentials: 'same-origin', method: rest.method || (json !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(rest.headers || {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.error || 'HTTP ' + r.status, r.status);
  return d as T;
}

const TZ = 'Asia/Jakarta';
export const fmtTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtAgo = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? 'baru saja' : m < 60 ? m + ' mnt lalu' : m < 1440 ? Math.round(m / 60) + ' jam lalu' : Math.round(m / 1440) + ' hari lalu';
};
export const usd = (n: number) => '$' + (n || 0).toFixed(n < 1 ? 3 : 2);

export const STATUS_LABEL: Record<string, string> = { queued: 'Antre', assigned: 'Ditugaskan', in_progress: 'Dikerjakan', review: 'Perlu keputusan', approved: 'Terjadwal', completed: 'Selesai', failed: 'Gagal', blocked: 'Terblokir', changes_requested: 'Revisi', rejected: 'Ditolak', cancelled: 'Dibatalkan', pending: 'Menunggu', running: 'Dikerjakan', awaiting_approval: 'Perlu keputusan', skipped: 'Dilewati', awaiting_connection: 'Akun belum terhubung', scheduled: 'Terjadwal', publishing: 'Mengunggah', processing: 'Diproses platform', published: 'Tayang' };
export const TYPE_LABEL: Record<string, string> = { text: 'Tugas', animated_video: 'Video', web_build: 'Web baru', web_update: 'Update web', story_series: 'Seri cerita', story_episode: 'Part cerita' };
export type Profile = { id: string; name: string; handle: string; topic: string; audience: string; tone: string; forbidden: string; notes: string; is_default: boolean };
export const GATE: Record<string, string> = { script_check: 'approve_script', ideas: 'choose_idea', qa_video: 'video_review', distribution: 'publish', plan: 'approve_plan', qa_web: 'web_review', series_plan: 'approve_series' };
export const REVISE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  video_review: [{ value: 'auto', label: 'Otomatis (Alex yang menentukan)' }, { value: 'script', label: 'Naskah (Felix)' }, { value: 'storyboard', label: 'Visual & storyboard (Ethan)' }, { value: 'audio_direction', label: 'Suara (Maya)' }, { value: 'render_video', label: 'Render ulang saja' }],
  web_review: [{ value: 'auto', label: 'Otomatis (Alex yang menentukan)' }, { value: 'plan', label: 'Rencana (Arvin)' }, { value: 'implement', label: 'Kode & tampilan (Nathan)' }],
};

/** "YYYY-MM-DD HH:mm" WIB -> value for <input type="datetime-local"> in the browser's timezone. */
export function wibToLocalInput(s: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  let d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 7, +m[5]!)) : new Date(Date.now() + 3600000);
  if (d.getTime() < Date.now() + 10 * 60000) d = new Date(Date.now() + 3600000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
