'use client';

import { lazy, Suspense, useState } from 'react';
import { useChatPanel } from './chatPanelContext';

/**
 * The panel's code (the thread, the composer, the run views) loads the
 * first time the person opens it, not with every app page: the layout puts
 * this slot on every page, and a page where nobody opens Chat downloads
 * none of it. Once opened it stays, so a closed panel keeps its chat and a
 * run under way (item 19).
 */
const ChatSidePanel = lazy(() =>
  import('./ChatSidePanel').then((module) => ({ default: module.ChatSidePanel })),
);

export function ChatSidePanelSlot() {
  const panel = useChatPanel();
  const [wanted, setWanted] = useState(false);
  if (panel?.open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <ChatSidePanel />
    </Suspense>
  );
}
