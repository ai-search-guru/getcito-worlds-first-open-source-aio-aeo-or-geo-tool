// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat's scheduled jobs' minute (W3-01): POST /api/internal/chat/schedules/
 * tick, called by the API server's cron after the agents' tick with
 * CHAT_INTERNAL_SECRET. Not there with the new Chat off, before the secret
 * is read; a wrong or missing secret is 401; a good call settles the open
 * runs, resumes the jobs the AI limit paused and runs the due ones with the
 * schedule run driver, each apart from the others; then the weekly skill
 * update check (W4-31), in its window or when named.
 */

const fakes = vi.hoisted(() => ({
  settle: vi.fn(),
  resume: vi.fn(),
  due: vi.fn(),
  driver: vi.fn(),
  skillUpdates: vi.fn(),
}));
vi.mock('@/lib/chat/schedule/worker', () => ({
  settleOpenRuns: fakes.settle,
  resumeCapPausedJobs: fakes.resume,
  fireDueJobs: fakes.due,
  scheduleRunDriver: fakes.driver,
}));

vi.mock('@/lib/chat/skills/updates', () => ({ checkSkillUpdates: fakes.skillUpdates }));

const tick = await import('./route');

const SECRET = 'a-long-shared-secret';
const counts = { due: 1, started: 1, skipped: 0, paused: 0, busy: 0, failed: 0 };
const checked = { window: false, checked: 0, updates: 0, switchedOff: 0, unreadable: 0 };

const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  tick.POST(
    new Request('http://localhost/api/internal/chat/schedules/tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_INTERNAL_SECRET', SECRET);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fakes.settle.mockResolvedValue(2);
  fakes.resume.mockResolvedValue(1);
  fakes.due.mockResolvedValue(counts);
  fakes.skillUpdates.mockResolvedValue(checked);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/internal/chat/schedules/tick', () => {
  it('is not there with the new Chat off, whatever the secret', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await post({})).status).toBe(404);
    expect(fakes.due).not.toHaveBeenCalled();
  });

  it('refuses a wrong, missing or bare secret, and any secret when none is set', async () => {
    for (const auth of ['Bearer nope', `Bearer ${SECRET}x`, SECRET, null]) {
      expect((await post({}, auth)).status).toBe(401);
    }
    vi.stubEnv('CHAT_INTERNAL_SECRET', '');
    expect((await post({}, 'Bearer ')).status).toBe(401);
    expect(fakes.settle).not.toHaveBeenCalled();
    expect(fakes.due).not.toHaveBeenCalled();
  });

  it('settles, resumes, then runs the due jobs with the schedule run driver', async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settled: 2,
      resumed: 1,
      due: counts,
      skillUpdates: checked,
    });
    expect(fakes.settle).toHaveBeenCalledWith(expect.any(Date));
    expect(fakes.resume).toHaveBeenCalledWith(expect.any(Date));
    expect(fakes.due).toHaveBeenCalledWith(expect.any(Date), fakes.driver);
    // In turn: the open runs first, the due jobs last.
    expect(fakes.settle.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.due.mock.invocationCallOrder[0],
    );
  });

  it('runs the jobs asked for, and refuses an unknown one', async () => {
    expect(await (await post({ jobs: ['due'] })).json()).toEqual({
      ok: true,
      settled: null,
      resumed: null,
      due: counts,
      skillUpdates: null,
    });
    expect(fakes.settle).not.toHaveBeenCalled();
    expect((await post({ jobs: ['sweep'] })).status).toBe(400);
    expect((await post({ jobs: [] })).status).toBe(400);
  });

  it('runs the others when one fails, and answers 500 naming it', async () => {
    fakes.settle.mockRejectedValue(new Error('db down'));
    const res = await post({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'failed',
      failed: ['settle'],
      settled: null,
      resumed: 1,
      due: counts,
      skillUpdates: checked,
    });
    expect(fakes.due).toHaveBeenCalled();
  });

  it('checks skill updates in their daily window, and at once when named by hand (W4-31)', async () => {
    await post({});
    expect(fakes.skillUpdates).toHaveBeenLastCalledWith(expect.any(Date), { force: false });
    await post({ jobs: ['skill_updates'] });
    expect(fakes.skillUpdates).toHaveBeenLastCalledWith(expect.any(Date), { force: true });
    expect(fakes.due).toHaveBeenCalledTimes(1);
  });
});
