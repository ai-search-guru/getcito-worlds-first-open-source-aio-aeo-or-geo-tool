'use client';

import { useEffect, useState } from 'react';
import type { ConnectionRecord } from '@/lib/chat/connections';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * The brand open now's connections (GET /api/chat/connections, W4-24), as
 * the chat menu's Connections row and the Connections page read them. A
 * change on the page (Disconnect) reads them again everywhere
 * (refreshConnections).
 */

export interface ConnectionsState {
  status: 'loading' | 'ready' | 'error';
  connections: ConnectionRecord[];
  /** The person is an Admin: they connect and disconnect from Chat. */
  canConnect: boolean;
  brandId: string | null;
}

const listeners = new Set<() => void>();

/** Reads every open list of connections again. */
export function refreshConnections() {
  for (const listener of listeners) listener();
}

const LOADING: Omit<ConnectionsState, 'brandId'> = {
  status: 'loading',
  connections: [],
  canConnect: false,
};

/** The brand's connections; `enabled` false reads nothing (the menu's list while folded). */
export function useConnections(enabled = true): ConnectionsState & { retry: () => void } {
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [reads, setReads] = useState(0);
  const [read, setRead] = useState<ConnectionsState | null>(null);

  useEffect(() => {
    const listener = () => setReads((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !brandId) return;
    let current = true;
    const done = (state: Omit<ConnectionsState, 'brandId'>) => {
      if (current) setRead({ ...state, brandId });
    };
    void fetch(`/api/chat/connections?brand=${encodeURIComponent(brandId)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          connections?: ConnectionRecord[];
          canConnect?: boolean;
        } | null;
        if (!res.ok || !body?.ok || !Array.isArray(body.connections)) {
          done({ ...LOADING, status: 'error' });
          return;
        }
        done({ status: 'ready', connections: body.connections, canConnect: !!body.canConnect });
      })
      .catch(() => done({ ...LOADING, status: 'error' }));
    return () => {
      current = false;
    };
  }, [brandId, enabled, reads]);

  // Another brand's list is still loading for this one; a refresh keeps the last list meanwhile.
  const fresh = read && read.brandId === brandId ? read : null;
  return {
    ...(fresh ?? { ...LOADING, brandId }),
    retry: () => setReads((n) => n + 1),
  };
}

/** Connected first, then failing, then the ones to connect, then Soon: the menu's order. */
export function menuOrder(connections: readonly ConnectionRecord[]): ConnectionRecord[] {
  const rank = { connected: 0, failing: 1, not_connected: 2, soon: 3 } as const;
  return [...connections].sort((a, b) => rank[a.status] - rank[b.status]);
}

/** More connections than this, and the menu's list gets a search box (agentic plan §6). */
export const MENU_SEARCH_FROM = 20;
