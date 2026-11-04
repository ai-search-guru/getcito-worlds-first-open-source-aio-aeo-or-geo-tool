'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { menuSectionsFor } from '@/lib/menuAccess';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';

interface MenuAccessValue {
  /** The left-menu sections the viewer's menu leaves out. */
  hidden: ReadonlySet<string>;
  /** Admin, or a manager an admin let change menus: Settings › Menu access. */
  canManageMenus: boolean;
}

/**
 * The viewer's menu access (00374), read once by the dashboard layout. The
 * whole menu by default, so a tree without the provider shows every section.
 */
const MenuAccessContext = createContext<MenuAccessValue>({
  hidden: new Set(),
  canManageMenus: false,
});

export function MenuAccessProvider({
  hidden,
  canManageMenus,
  children,
}: {
  hidden: string[];
  canManageMenus: boolean;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ hidden: new Set(hidden), canManageMenus }),
    [hidden, canManageMenus],
  );
  return <MenuAccessContext.Provider value={value}>{children}</MenuAccessContext.Provider>;
}

export function useHiddenMenuSections(): ReadonlySet<string> {
  return useContext(MenuAccessContext).hidden;
}

export function useCanManageMenus(): boolean {
  return useContext(MenuAccessContext).canManageMenus;
}

/**
 * The left menu's sections this workspace has, in its order: Agent Center
 * only with the new Chat on (CHAT_AGENTIC). What the menu-access lists show.
 */
export function useMenuSections(): string[] {
  const chatAgentic = useChatAgentic();
  return useMemo(() => menuSectionsFor(chatAgentic), [chatAgentic]);
}
