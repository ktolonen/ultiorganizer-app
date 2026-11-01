import { create } from 'zustand';
import { useColorScheme } from 'react-native';
import { DARK, LIGHT, type Palette } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

export const useThemeMode = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>((set) => ({
  mode: 'system',
  setMode: (mode) => set({ mode }),
}));

/** Reads the stored setting; 'day' and 'night' are the names older builds stored. */
export const parseThemeMode = (v: string | null): ThemeMode => {
  if (v === 'light' || v === 'day') return 'light';
  if (v === 'dark' || v === 'night') return 'dark';
  return 'system';
};

/** Light or Dark, following the system unless chosen. No sunset-based mode: it would need location access. */
export function useTheme(): { palette: Palette; dark: boolean } {
  const system = useColorScheme();
  const mode = useThemeMode((s) => s.mode);
  const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
  return { palette: dark ? DARK : LIGHT, dark };
}
