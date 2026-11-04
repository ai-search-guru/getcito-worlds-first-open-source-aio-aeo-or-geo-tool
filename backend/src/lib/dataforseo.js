const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com';
const DATAFORSEO_API_URL = `${DATAFORSEO_BASE_URL}/v3/keywords_data/google_ads/search_volume/live`;

/** Tasks one task_post request takes (DataForSEO's own limit). */
export const MAX_TASKS_PER_POST = 100;

/** Whether the server has DataForSEO's login and password. */
export function isDataForSeoConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

function getAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error(
      'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in environment variables',
    );
  }

  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

/**
 * Fetch Google Ads search volume for a list of keywords via DataForSEO.
 * @param {string[]} keywords - Up to 1000 keywords
 * @param {{ locationCode?: number, languageCode?: string }} options
 * @returns {Promise<Record<string, { volume: number, competitionIndex: number | null, competition: string | null }>>}
 *   Map of keyword → { monthly search volume, Google Ads competition index (0–100), competition label }
 */
export async function getSearchVolumes(keywords, options = {}) {
  const body = [
    {
      keywords,
      ...(options.locationCode && { location_code: options.locationCode }),
      ...(options.languageCode && { language_code: options.languageCode }),
    },
  ];

  const response = await fetch(DATAFORSEO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${data.status_message || 'Unknown error'}`);
  }

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(`DataForSEO task error: ${task?.status_message || 'No task returned'}`);
  }

  const volumes = {};
  for (const item of task.result || []) {
    volumes[item.keyword] = {
      volume: item.search_volume ?? 0,
      competitionIndex: item.competition_index ?? null,
      competition: item.competition ?? null, // "LOW" | "MEDIUM" | "HIGH" | null
    };
  }

  return volumes;
}

/** One request to DataForSEO's API, its whole answer once the request itself went through. */
async function callApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${data.status_message || 'Unknown error'}`);
  }
  return data;
}

/**
 * Standard (queued) tasks, set at once: `path` is the endpoint's own, without
 * `/task_post` (e.g. /v3/serp/google/organic). Each task carries a `tag`, and
 * the answer maps each tag to its task's id; a task DataForSEO refused has no
 * entry. Charged as each task is set.
 *
 * Sent MAX_TASKS_PER_POST at a time. A request that fails costs only its own
 * tasks: the others are still set, and what was set comes back. `onChunk`
 * is awaited with each request's ids as soon as they're in, so the caller
 * can keep them before the next one goes (a task set is paid for); an error
 * it throws stops the rest.
 *
 * @param {string} path
 * @param {Array<{ tag: string } & Record<string, unknown>>} tasks
 * @param {{ onChunk?: (ids: Map<string, string>) => Promise<void> | void }} [options]
 * @returns {Promise<{ ids: Map<string, string>, failed: number, errors: string[] }>}
 *   tag → task id; `failed`: tasks in the requests that failed, and why
 */
export async function postTasks(path, tasks, { onChunk } = {}) {
  const ids = new Map();
  const errors = [];
  let failed = 0;
  for (let i = 0; i < tasks.length; i += MAX_TASKS_PER_POST) {
    const chunk = tasks.slice(i, i + MAX_TASKS_PER_POST);
    let data;
    try {
      data = await callApi(`${path}/task_post`, { method: 'POST', body: chunk });
    } catch (err) {
      failed += chunk.length;
      errors.push(err?.message ?? String(err));
      continue;
    }
    const set = new Map();
    for (const task of data.tasks ?? []) {
      // 20100: Task Created.
      const tag = task?.data?.tag;
      if (task?.status_code === 20100 && task.id && typeof tag === 'string') set.set(tag, task.id);
    }
    for (const [tag, id] of set) ids.set(tag, id);
    if (onChunk && set.size > 0) await onChunk(set);
  }
  return { ids, failed, errors };
}

/**
 * The endpoint's tasks that are done and not collected yet (up to 1,000,
 * from the last three days), each with the tag it was set with. A task
 * leaves the list once its result is read.
 *
 * @param {string} path e.g. /v3/keywords_data/google_trends/explore
 * @returns {Promise<Map<string, string | null>>} task id → tag
 */
export async function readyTasks(path) {
  const data = await callApi(`${path}/tasks_ready`);
  const ready = new Map();
  for (const task of data.tasks ?? []) {
    for (const done of task?.result ?? []) {
      if (done?.id) ready.set(done.id, typeof done.tag === 'string' ? done.tag : null);
    }
  }
  return ready;
}

/** Status codes of a task still being worked on: 40601 Task Handed, 40602 Task In Queue. */
const PENDING = new Set([40601, 40602]);

/**
 * One task's result, read from its task_get path (with the id in it).
 * `done` with the first result, or with null when the search found nothing
 * (40102); `pending` while it waits its turn; `gone` when DataForSEO no
 * longer has it (40401, results are kept 30 days).
 *
 * @param {string} path e.g. /v3/serp/google/organic/task_get/advanced/<id>
 * @returns {Promise<{ status: 'done', result: object | null } | { status: 'pending' | 'gone' }>}
 */
export async function getTask(path) {
  const data = await callApi(path);
  const task = data.tasks?.[0];
  if (!task) throw new Error('DataForSEO task error: No task returned');
  if (task.status_code === 20000) return { status: 'done', result: task.result?.[0] ?? null };
  if (task.status_code === 40102) return { status: 'done', result: null };
  if (PENDING.has(task.status_code)) return { status: 'pending' };
  if (task.status_code === 40401) return { status: 'gone' };
  throw new Error(`DataForSEO task error: ${task.status_message || task.status_code}`);
}
