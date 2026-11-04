'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ComposerDraft } from './composer/ChatComposer';

/**
 * Chat Home's box, filled from the page above it (CHAT-11 item 9; W4-21):
 * What's new's Show me puts "What's new: how can {feature} help me?" in it
 * and doesn't send. Only Home has it: elsewhere the box takes the page's
 * own draft.
 */
const HomeDraft = createContext<{
  draft: ComposerDraft | null;
  fill: (text: string) => void;
} | null>(null);

export function HomeDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  return (
    <HomeDraft.Provider
      value={{
        draft,
        // Its own nonces, never the page's (?compose= is 1): each Show me fills the box again.
        fill: (text) =>
          setDraft((was) => ({ nonce: Math.max(Date.now(), (was?.nonce ?? 0) + 1), text })),
      }}
    >
      {children}
    </HomeDraft.Provider>
  );
}

/** What Home's page put in the box; null outside Home. */
export function useHomeDraft(): ComposerDraft | null {
  return useContext(HomeDraft)?.draft ?? null;
}

/** Puts text in Home's box, without sending it; nothing outside Home. */
export function useFillHomeDraft(): ((text: string) => void) | null {
  return useContext(HomeDraft)?.fill ?? null;
}
