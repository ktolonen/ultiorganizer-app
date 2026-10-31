import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deleteLinkToken } from '../store/secure';
import type { Repo, ServerRow } from '../store/repo';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { SPACE, TARGET } from '../ui/tokens';

type RecentGame = Awaited<ReturnType<Repo['listGames']>>[number];

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const [servers, setServers] = useState<ServerRow[] | null>(null);
  const [games, setGames] = useState<RecentGame[]>([]);

  const load = useCallback(async () => {
    const repo = await getRepo();
    setServers(await repo.listServers());
    setGames(await repo.listGames());
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const doRemove = async (g: RecentGame) => {
    const repo = await getRepo();
    await repo.deleteGame(g.serverId, g.gameId);
    await deleteLinkToken(g.serverId, g.gameId);
    await load();
  };

  // Deleting a game with unsent entries loses them, so it is always confirmed.
  const remove = (g: RecentGame) =>
    Alert.alert(
      g.title,
      g.unsent > 0 ? t('home.deleteUnsent', { count: g.unsent }) : t('home.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('home.delete'), style: 'destructive', onPress: () => void doRemove(g) },
      ],
    );

  const serverLabel = (id: number) => servers?.find((s) => s.id === id)?.label ?? '';

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.scroll}>
        <View style={layout.row}>
          <Txt variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {t('home.title')}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.title')}
            onPress={() => router.push('/settings')}
            hitSlop={8}
            style={({ pressed }) => [styles.headerLink, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Txt variant="heading">{t('settings.title')}</Txt>
          </Pressable>
        </View>

        {servers?.length === 0 && <Txt muted>{t('home.noServers')}</Txt>}
        <Button label={t('home.scan')} onPress={() => router.push('/scan')} />
        <Button
          label={t('home.timekeeper')}
          kind="secondary"
          onPress={() => router.push('/timekeeper')}
        />

        <Divider />
        <Txt variant="heading" accessibilityRole="header">
          {t('home.recent')}
        </Txt>
        {games.length === 0 && <Txt muted>{t('home.recentEmpty')}</Txt>}
        {games.map((g) => (
          <View
            key={`${g.serverId}:${g.gameId}`}
            style={[styles.card, { borderColor: palette.line }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={g.title}
              onPress={() => router.push(`/game/${g.serverId}/${g.gameId}`)}
              style={({ pressed }) => [styles.cardMain, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Txt variant="heading">{g.title}</Txt>
              <Txt variant="small" muted>
                {serverLabel(g.serverId)}
                {' · '}
                <Txt
                  variant="small"
                  style={{ color: g.unsent > 0 ? palette.signalStop : palette.muted }}
                >
                  {g.unsent > 0 ? t('home.unsent', { count: g.unsent }) : t('home.synced')}
                </Txt>
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('home.delete')}: ${g.title}`}
              onPress={() => remove(g)}
              style={({ pressed }) => [styles.cardDelete, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Txt variant="small" style={{ color: palette.signalStop }}>
                {t('home.deleteShort')}
              </Txt>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerLink: { minHeight: TARGET.min, justifyContent: 'center', paddingHorizontal: SPACE.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 12,
  },
  cardMain: { flex: 1, gap: 2, padding: SPACE.md, minHeight: TARGET.min },
  cardDelete: {
    minHeight: TARGET.min,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
  },
});
