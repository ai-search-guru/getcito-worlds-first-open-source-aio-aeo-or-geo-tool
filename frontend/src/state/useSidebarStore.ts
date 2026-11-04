import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarStore {
  isOpen: boolean;
  isCollapsed: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleCollapse: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isOpen: true,
      // Collapsed by default: the sidebar opens over the page on hover, and
      // its button keeps it open for those who want it pinned.
      isCollapsed: true,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggleCollapse: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
    }),
    {
      name: 'sidebar-store',
      // Version 1 made collapsed the default. A stored state from before it
      // holds the old default rather than a choice, so it starts collapsed too.
      version: 1,
      migrate: (persisted, version) =>
        version < 1 ? { ...(persisted as SidebarStore), isCollapsed: true } : persisted,
    },
  ),
);
