import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';

type Theme = 'dark' | 'light';
export type Accent = 'aqua' | 'iris' | 'rose' | 'amber' | 'sage';
interface ThemeContextType {
  theme: Theme;
  accent: Accent;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', accent: 'aqua', setTheme: () => {}, setAccent: () => {}, toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('chatistry-theme') as Theme) : null) ?? 'dark'
  );
  const [accent, setAccent] = useState<Accent>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('chatistry-accent') as Accent) : null) ?? 'aqua'
  );
  const [preferencesUserId, setPreferencesUserId] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatistry-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem('chatistry-accent', accent);
  }, [accent]);

  // Browser storage makes the app feel instant. Supabase makes the choice follow
  // the account to a different browser or device after the migration is applied.
  useEffect(() => {
    let cancelled = false;
    const loadPreferences = async (userId: string) => {
      const { data, error } = await supabase.from('user_preferences')
        .select('theme, accent').eq('user_id', userId).maybeSingle();
      if (!cancelled && data && !error) {
        setTheme(data.theme as Theme);
        setAccent(data.accent as Accent);
      }
      if (!cancelled) setPreferencesUserId(userId);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadPreferences(session.user.id);
      else setPreferencesUserId(null);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!preferencesUserId) return;
    supabase.from('user_preferences').upsert({
      user_id: preferencesUserId, theme, accent, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).then(({ error }) => {
      // The UI still works from local storage until the supplied migration is run.
      if (error) console.warn('Could not save appearance preference:', error.message);
    });
  }, [theme, accent, preferencesUserId]);
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return <ThemeContext.Provider value={{ theme, accent, setTheme, setAccent, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
