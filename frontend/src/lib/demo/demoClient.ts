import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';

/**
 * The organization's demo brand on the API (POST and PATCH /api/demo), from
 * the browser through the API's same-origin proxy. Never throws: a call
 * that failed answers `ok: false` with its HTTP status (0 when it never got
 * an answer).
 */
export type DemoCall<T> = ({ ok: true } & T) | { ok: false; status: number };

async function call<T>(
  init: RequestInit,
  read: (body: Record<string, unknown>) => T | null,
): Promise<DemoCall<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, status: 401 };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/demo`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status };
    const value = read(body);
    return value ? { ok: true, ...value } : { ok: false, status: res.status };
  } catch (err) {
    console.error('Demo brand call failed:', err);
    return { ok: false, status: 0 };
  }
}

export interface DemoEnsured {
  brandId: string;
  version: number;
  /** Its sample data was written again just now (made, or an older version brought up to date). */
  rebuilt: boolean;
}

/**
 * The organization's demo brand, made when it has none and its sample data
 * brought up to date when the product moved on since it was written.
 */
export function ensureDemoBrand(): Promise<DemoCall<DemoEnsured>> {
  return call({ method: 'POST', body: '{}' }, (body) =>
    typeof body.brandId === 'string'
      ? {
          brandId: body.brandId,
          version: typeof body.version === 'number' ? body.version : 0,
          rebuilt: body.rebuilt === true,
        }
      : null,
  );
}

/** The setup asked for on this page: when it was asked, and whether it answered. */
export interface DemoPreparation {
  startedAt: number;
  answered: boolean;
}

type Asked = DemoPreparation & { request: Promise<DemoCall<DemoEnsured>> };

// The setup asked for on this page, shared by whoever asks next.
let preparing: Asked | null = null;

/**
 * The demo brand's setup, asked once per page: a screen that offers the
 * demo starts it ahead in the background (it takes a while the first time),
 * and the click that opens the demo waits for that same request, done at
 * once when it is. A failed one is asked again next time.
 */
export function prepareDemoBrand(): Promise<DemoCall<DemoEnsured>> {
  if (!preparing) {
    const asked: Asked = {
      startedAt: Date.now(),
      answered: false,
      request: ensureDemoBrand().then((result) => {
        asked.answered = true;
        if (!result.ok && preparing === asked) preparing = null;
        return result;
      }),
    };
    preparing = asked;
  }
  return preparing.request;
}

/**
 * Where the setup asked on this page stands (null when none is under way or
 * done): the click that opens the demo shows the setup screen while it is
 * still waited for, counted from when it was asked.
 */
export function demoPreparation(): DemoPreparation | null {
  return preparing && { startedAt: preparing.startedAt, answered: preparing.answered };
}

/** Lets tests ask again. */
export function resetDemoPreparation() {
  preparing = null;
}

/** Hides the demo brand from the brand list, or shows it again; it is never deleted. */
export function setDemoHidden(
  hidden: boolean,
): Promise<DemoCall<{ brandId: string; hidden: boolean }>> {
  return call({ method: 'PATCH', body: JSON.stringify({ hidden }) }, (body) =>
    typeof body.brandId === 'string'
      ? { brandId: body.brandId, hidden: body.hidden === true }
      : null,
  );
}
