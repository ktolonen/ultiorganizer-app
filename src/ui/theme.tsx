import { create } from 'zustand';
import { useColorScheme } from 'react-native';
import { DAY, NIGHT, type Palette } from './tokens';

export type ThemeMode = 'system' | 'day' | 'night';

export const useThemeMode = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>((set) => ({
  mode: 'system',
  setMode: (mode) => set({ mode }),
}));

export const parseThemeMode = (v: string | null): ThemeMode =>
  v === 'day' || v === 'night' ? v : 'system';

/** Day or Night, following the system unless chosen. No sunset-based mode: it would need location access. */
export function useTheme(): { palette: Palette; dark: boolean } {
  const system = useColorScheme();
  const mode = useThemeMode((s) => s.mode);
  const dark = mode === 'night' || (mode === 'system' && system === 'dark');
  return { palette: dark ? NIGHT : DAY, dark };
}
