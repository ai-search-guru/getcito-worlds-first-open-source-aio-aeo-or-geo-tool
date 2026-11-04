/**
 * A browser tab opened by a click, for a page that is ready only once the
 * click's work is done. A tab opened after an `await` is blocked as a
 * pop-up, so it opens at once with a line saying what is happening, then
 * moves to the page, or closes when there is nothing to show.
 */
export interface PendingTab {
  /** False when the browser blocked the tab. */
  readonly opened: boolean;
  go(href: string): void;
  close(): void;
}

export function openPendingTab(message: string): PendingTab {
  const tab = window.open('', '_blank');
  if (tab) {
    try {
      tab.document.title = message;
      tab.document.body.style.font = '14px system-ui, sans-serif';
      tab.document.body.style.margin = '24px';
      tab.document.body.textContent = message;
    } catch {
      // A tab we can't write to still moves on to the page.
    }
  }
  const live = () => tab !== null && !tab.closed;
  return {
    opened: tab !== null,
    // Absolute, as the blank tab has no address of its own to resolve against.
    go: (href) => {
      if (live()) tab!.location.replace(new URL(href, window.location.origin).toString());
    },
    close: () => {
      if (live()) tab!.close();
    },
  };
}
