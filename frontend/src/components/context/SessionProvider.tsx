'use client';

import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuthStore } from '@/state/useAuthStore';

interface SessionProviderProps {
  user: User | null;
}

export function SessionProvider({ user }: SessionProviderProps) {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    setUser(user);
    setLoading(false);
  }, [user, setUser, setLoading]);

  return null;
}
