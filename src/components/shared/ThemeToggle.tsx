// TODO: This component is temporarily disabled
// Theme switching functionality will be implemented in the future
// Currently using light theme by default

'use client'
import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export default function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <div className="relative">
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="appearance-none bg-background border border-border rounded-lg px-3 py-2 pr-8 text-foreground hover:bg-accent transition-colors"
      >
        {themeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
        {themeOptions.map((option) => {
          if (option.value === theme) {
            const Icon = option.icon;
            return (
              <Icon 
                key={option.value} 
                className="h-4 w-4 text-foreground" 
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// Alternative dropdown version (more accessible)
export function ThemeDropdown(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = React.useState(false);

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  const currentTheme = themeOptions.find(option => option.value === theme);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center space-x-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors ${
          isOpen ? 'ring-2 ring-primary' : ''
        }`}
      >
        {currentTheme && (
          <>
            <currentTheme.icon className="h-4 w-4 text-foreground" />
            <span className="text-foreground">{currentTheme.label}</span>
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-32 bg-background border border-border rounded-lg shadow-lg z-50">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isActive = option.value === theme;
            
            return (
              <button
                key={option.value}
                onClick={() => {
                  setTheme(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-2 hover:bg-accent transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  isActive ? 'bg-accent text-foreground' : 'text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {option.value === 'light' && '☀️'}
                  {option.value === 'dark' && '🌙'}
                  {option.value === 'system' && '💻'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
} 