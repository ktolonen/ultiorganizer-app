// Per-weight entry points: the package index would bundle every weight of both families.
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { AtkinsonHyperlegibleNext_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-next/400Regular';
import { AtkinsonHyperlegibleNext_700Bold } from '@expo-google-fonts/atkinson-hyperlegible-next/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { initI18n, LANGUAGE_KEY, parseLanguagePref, setLanguage } from '../i18n';
import { deleteLinkToken, deleteSavedLinkToken } from '../store/secure';
import { getRepo } from '../store/sqlite';
import { parseThemeMode, useTheme, useThemeMode } from '../ui/theme';
import { FONTS } from '../ui/tokens';

void SplashScreen.preventAutoHideAsync();
initI18n();

const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [FONTS.figures]: BarlowCondensed_700Bold,
    [FONTS.figuresSemi]: BarlowCondensed_600SemiBold,
    [FONTS.text]: AtkinsonHyperlegibleNext_400Regular,
    [FONTS.textBold]: AtkinsonHyperlegibleNext_700Bold,
  });
  const [ready, setReady] = useState(false);
  const setMode = useThemeMode((s) => s.setMode);
  const { palette, dark } = useTheme();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repo = await getRepo();
        setMode(parseThemeMode(await repo.getSetting('theme')));
        // Before the splash hides, so a chosen language never flashes the device one.
        setLanguage(parseLanguagePref(await repo.getSetting(LANGUAGE_KEY)));
        // Local game data is deleted 30 days after a game is finalized and synced.
        for (const g of await repo.purgeOldGames(Date.now())) {
          await deleteLinkToken(g.serverId, g.gameId);
        }
        for (const id of await repo.purgeOldLinks(Date.now())) await deleteSavedLinkToken(id);
        await repo.purgeCache(Date.now());
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [setMode]);

  const done = (fontsLoaded || fontError) && ready;
  useEffect(() => {
    if (done) void SplashScreen.hideAsync();
  }, [done]);
  if (!done) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.surface },
          animation: 'fade',
        }}
      />
    </QueryClientProvider>
  );
}
