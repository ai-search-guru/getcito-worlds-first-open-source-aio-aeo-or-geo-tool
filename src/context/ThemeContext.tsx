'use client'
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  // TODO: Implement dark/light theme switching in the future
  // For now, we'll use light theme by default
  const [theme] = useState<Theme>('light');
  const [actualTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // TODO: Restore theme switching functionality
    // const savedTheme = localStorage.getItem('theme') as Theme || 'system';
    // setTheme(savedTheme);
  }, []);

  // TODO: Restore theme switching functionality
  // useEffect(() => {
  //   if (!mounted) return;
  //
  //   const updateActualTheme = () => {
  //     if (theme === 'system') {
  //       const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  //       setActualTheme(systemTheme);
  //     } else {
  //       setActualTheme(theme);
  //     }
  //   };
  //
  //   updateActualTheme();
  //
  //   // Listen for system theme changes
  //   const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  //   mediaQuery.addEventListener('change', updateActualTheme);
  //
  //   return () => mediaQuery.removeEventListener('change', updateActualTheme);
  // }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;

    // Apply light theme to document
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add('light'); // Force light theme

    // TODO: Restore theme persistence
    // localStorage.setItem('theme', theme);
  }, [mounted]);

  // TODO: Restore theme switching functionality
  const handleSetTheme = (newTheme: Theme) => {
    // setTheme(newTheme);
    console.log('Theme switching will be implemented in the future:', newTheme);
  };

  // Prevent hydration mismatch - use light theme
  if (!mounted) {
    return <div className="light">{children}</div>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, actualTheme }}>
      <div className="light">
        {children}
      </div>
    </ThemeContext.Provider>
  );
} 