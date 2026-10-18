import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deleteLinkToken } from '../store/secure';
import { AUTO_POINT_KEY, parseAutoPoint, type Repo, type ServerRow } from '../store/repo';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useThemeMode, type ThemeMode } from '../ui/theme';

type RecentGame = Awaited<ReturnType<Repo['listGames']>>[number];

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [games, setGames] = useState<RecentGame[]>([]);
  const { mode, setMode } = useThemeMode();
  const [autoPoint, setAutoPoint] = useState(true);
  useEffect(() => {
    void getRepo().then(async (r) =>
      setAutoPoint(parseAutoPoint(await r.getSetting(AUTO_POINT_KEY))),
    );
  }, []);

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

  const serverLabel = (id: number) => servers.find((s) => s.id === id)?.label ?? '';
  const modes: ThemeMode[] = ['system', 'day', 'night'];

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.page}>
        <Txt variant="title" accessibilityRole="header">
          {t('home.title')}
        </Txt>
        <Button label={t('home.scan')} onPress={() => router.push('/scan')} />
        <Button
          label={t('home.timekeeper')}
          kind="secondary"
          onPress={() => router.push('/timekeeper')}
        />
        <Button label={t('home.pair')} kind="secondary" onPress={() => router.push('/pair')} />

        {servers.length > 0 && (
          <View style={{ gap: 4 }}>
            <Txt variant="heading">{t('home.servers')}</Txt>
            {servers.map((s) => (
              <Txt key={s.id} muted>
                {s.label}
              </Txt>
            ))}
          </View>
        )}

        <Divider />
        <Txt variant="heading">{t('home.recent')}</Txt>
        {games.length === 0 && <Txt muted>{t('home.recentEmpty')}</Txt>}
        {games.map((g) => (
          <View key={`${g.serverId}:${g.gameId}`} style={{ gap: 4 }}>
            <Button
              label={g.title}
              kind="secondary"
              onPress={() => router.push(`/game/${g.serverId}/${g.gameId}`)}
            />
            <View style={layout.row}>
              <Txt variant="small" muted style={{ flex: 1 }}>
                {serverLabel(g.serverId)} ·{' '}
                {g.unsent > 0 ? t('home.unsent', { count: g.unsent }) : t('home.synced')}
              </Txt>
              <Txt
                variant="small"
                accessibilityRole="button"
                onPress={() => remove(g)}
                style={{ color: palette.signalStop, padding: 8 }}
              >
                {t('home.delete')}
              </Txt>
            </View>
          </View>
        ))}

        <Divider />
        <Txt variant="heading">{t('settings.theme')}</Txt>
        <View style={layout.row}>
          {modes.map((m) => (
            <View key={m} style={{ flex: 1 }}>
              <Button
                label={t(`settings.theme.${m}`)}
                kind={mode === m ? 'primary' : 'secondary'}
                onPress={async () => {
                  setMode(m);
                  (await getRepo()).setSetting('theme', m);
                }}
              />
            </View>
          ))}
        </View>

        <Txt variant="heading">{t('settings.autoPoint')}</Txt>
        <Txt variant="small" muted>
          {t('settings.autoPoint.hint')}
        </Txt>
        <Button
          label={autoPoint ? t('settings.on') : t('settings.off')}
          kind={autoPoint ? 'primary' : 'secondary'}
          onPress={async () => {
            const next = !autoPoint;
            setAutoPoint(next);
            (await getRepo()).setSetting(AUTO_POINT_KEY, next ? 'on' : 'off');
          }}
        />
      </ScrollView>
    </Screen>
  );
}
