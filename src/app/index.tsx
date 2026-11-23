import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isLocalGame } from '../game/local';
import { formatDayTime } from '../services/links';
import { usePendingLink } from '../services/pending';
import { deleteLinkToken, deleteSavedLinkToken, getSavedLinkToken } from '../store/secure';
import type { LinkRow, Repo, ServerRow } from '../store/repo';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { SPACE, TARGET } from '../ui/tokens';

type RecentGame = Awaited<ReturnType<Repo['listGames']>>[number];

export default function Home() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const setPending = usePendingLink((s) => s.set);
  const [servers, setServers] = useState<ServerRow[] | null>(null);
  const [games, setGames] = useState<RecentGame[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  // Set by the scanner after a setup QR: shown until Home is left, then dropped from the route.
  const { paired } = useLocalSearchParams<{ paired?: string }>();
  const [pairedNotice, setPairedNotice] = useState<string | null>(null);
  if (paired && paired !== pairedNotice) setPairedNotice(paired);
  useEffect(() => {
    if (paired) router.setParams({ paired: undefined });
  }, [paired, router]);

  const load = useCallback(async () => {
    const repo = await getRepo();
    setServers(await repo.listServers());
    setGames(await repo.listGames());
    setLinks(await repo.listLinks());
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => setPairedNotice(null);
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

  // A saved link reopens its game list without the camera; the token never enters the route.
  const openLink = async (l: LinkRow) => {
    const linkToken = await getSavedLinkToken(l.id);
    if (!linkToken) return removeLink(l);
    setPending({ serverId: l.serverId, linkToken });
    router.push('/games');
  };

  // Nothing is lost by forgetting a link: its games stay, and the QR can be scanned again.
  const removeLink = async (l: LinkRow) => {
    const repo = await getRepo();
    await repo.deleteLink(l.id);
    await deleteSavedLinkToken(l.id);
    await load();
  };

  const linkTitle = (l: LinkRow) => l.label || t('home.linkUnnamed');

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

        {pairedNotice && (
          <Txt accessibilityRole="alert" style={{ color: palette.signalGo }}>
            {t('pair.saved', { label: pairedNotice })}
          </Txt>
        )}
        {servers?.length === 0 && <Txt muted>{t('home.noServers')}</Txt>}
        {!!servers?.length && (
          <Txt variant="small" muted>
            {t('home.serversLine', { list: servers.map((s) => s.label).join(', ') })}
          </Txt>
        )}
        <Button label={t('home.scan')} onPress={() => router.push('/scan')} />
        <Button
          label={t('home.timekeeper')}
          kind="secondary"
          onPress={() => router.push('/timekeeper')}
        />
        <Button label={t('home.local')} kind="secondary" onPress={() => router.push('/local')} />

        {links.length > 0 && (
          <>
            <Divider />
            <Txt variant="heading" accessibilityRole="header">
              {t('home.links')}
            </Txt>
            {links.map((l) => (
              <View key={l.id} style={[styles.card, { borderColor: palette.line }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[linkTitle(l), formatDayTime(l.day, i18n.language)]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityHint={t('home.linkHint')}
                  onPress={() => void openLink(l)}
                  style={({ pressed }) => [styles.cardMain, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Txt variant="heading">{linkTitle(l)}</Txt>
                  <Txt variant="small" muted>
                    {[formatDayTime(l.day, i18n.language), serverLabel(l.serverId)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home.linkRemove')}: ${linkTitle(l)}`}
                  onPress={() => void removeLink(l)}
                  style={({ pressed }) => [styles.cardDelete, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Txt variant="small" style={{ color: palette.signalStop }}>
                    {t('home.linkRemoveShort')}
                  </Txt>
                </Pressable>
              </View>
            ))}
          </>
        )}

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
                {[formatDayTime(g.time, i18n.language), serverLabel(g.serverId)]
                  .filter(Boolean)
                  .join(' · ')}
                {' · '}
                <Txt
                  variant="small"
                  style={{ color: g.unsent > 0 ? palette.signalStop : palette.muted }}
                >
                  {isLocalGame(g.serverId)
                    ? t('home.localOnly')
                    : g.unsent > 0
                      ? t('home.unsent', { count: g.unsent })
                      : t('home.synced')}
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
