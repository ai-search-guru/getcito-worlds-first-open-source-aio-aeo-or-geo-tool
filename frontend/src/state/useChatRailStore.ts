import { create } from 'zustand';

/**
 * The app sidebar on Chat screens (CHAT-01 item 4f): the 56px rail, or
 * expanded by a click on the logo, as the person left it on any device
 * (chat_user_prefs.rail_open, 00408). The Chat shell sets it from the
 * server; it isn't kept in this browser. Elsewhere the sidebar keeps its
 * own pinned state (use-sidebar-store).
 */
interface ChatRailStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useChatRailStore = create<ChatRailStore>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
