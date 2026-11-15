import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { cleanOfficial, MAX_OFFICIAL_LENGTH } from '../game/reducer';
import { AUTO_POINT_KEY, parseAutoPoint, SCOREKEEPER_KEY, type ServerRow } from '../store/repo';
import { deleteAppToken, deleteLinkToken, deleteSavedLinkToken } from '../store/secure';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, TextField, Txt } from '../ui/components';
import { useThemeMode, type ThemeMode } from '../ui/theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [autoPoint, setAutoPoint] = useState(true);
  const [scorekeeper, setScorekeeper] = useState('');

  // Reload on focus so a server paired from here shows up on return.
  useFocusEffect(
    useCallback(() => {
      void getRepo().then(async (repo) => {
        setServers(await repo.listServers());
        setAutoPoint(parseAutoPoint(await repo.getSetting(AUTO_POINT_KEY)));
        setScorekeeper((await repo.getSetting(SCOREKEEPER_KEY)) ?? '');
      });
    }, []),
  );

  // Forgetting deletes the server's games from this phone, with any entries not yet sent,
  // so it is always confirmed. The tokens go after the rows: a crash in between only
  // leaves unused keys, never a server without its token.
  const doForget = async (server: ServerRow) => {
    const repo = await getRepo();
    const games = await repo.listGames(server.id);
    const links = await repo.listLinks(server.id);
    await repo.removeServer(server.id);
    for (const g of games) await deleteLinkToken(server.id, g.gameId);
    for (const l of links) await deleteSavedLinkToken(l.id);
    await deleteAppToken(server.id);
    setServers(await repo.listServers());
  };
  const forget = async (server: ServerRow) => {
    const games = await (await getRepo()).listGames(server.id);
    const unsent = games.reduce((n, g) => n + g.unsent, 0);
    Alert.alert(
      server.label,
      unsent > 0
        ? t('settings.forget.unsent', { count: unsent })
        : t('settings.forget.confirm', { count: games.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.forget'), style: 'destructive', onPress: () => void doForget(server) },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.scroll}>
        <Txt variant="title" accessibilityRole="header">
          {t('settings.title')}
        </Txt>

        <Txt variant="heading" accessibilityRole="header">
          {t('home.servers')}
        </Txt>
        {servers.length === 0 ? (
          <Txt muted>{t('settings.serversEmpty')}</Txt>
        ) : (
          <View style={{ gap: 4 }}>
            {servers.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt>{s.label}</Txt>
                </View>
                <Button label={t('settings.forget')} kind="secondary" onPress={() => forget(s)} />
              </View>
            ))}
          </View>
        )}
        <Button label={t('home.pair')} kind="secondary" onPress={() => router.push('/pair')} />

        <Divider />
        <Txt variant="heading" accessibilityRole="header">
          {t('term.scorekeeper')}
        </Txt>
        <Txt variant="small" muted>
          {t('settings.scorekeeper.hint')}
        </Txt>
        <TextField
          value={scorekeeper}
          // Saved as typed, so leaving the screen with the keyboard still up keeps it.
          onChangeText={async (text) => {
            setScorekeeper(text);
            await (await getRepo()).setSetting(SCOREKEEPER_KEY, cleanOfficial(text));
          }}
          onEndEditing={() => setScorekeeper((v) => cleanOfficial(v))}
          maxLength={MAX_OFFICIAL_LENGTH}
          placeholder={t('settings.scorekeeper.placeholder')}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel={t('term.scorekeeper')}
        />

        <Divider />
        <Txt variant="heading" accessibilityRole="header">
          {t('settings.theme')}
        </Txt>
        <View style={layout.row}>
          {MODES.map((m) => (
            <View key={m} style={{ flex: 1 }}>
              <Button
                label={t(`settings.theme.${m}`)}
                kind={mode === m ? 'primary' : 'secondary'}
                onPress={async () => {
                  setMode(m);
                  await (await getRepo()).setSetting('theme', m);
                }}
              />
            </View>
          ))}
        </View>

        <Divider />
        <Txt variant="heading" accessibilityRole="header">
          {t('settings.autoPoint')}
        </Txt>
        <Txt variant="small" muted>
          {t('settings.autoPoint.hint')}
        </Txt>
        <Button
          label={autoPoint ? t('settings.on') : t('settings.off')}
          kind={autoPoint ? 'primary' : 'secondary'}
          onPress={async () => {
            const next = !autoPoint;
            setAutoPoint(next);
            await (await getRepo()).setSetting(AUTO_POINT_KEY, next ? 'on' : 'off');
          }}
        />

        <Divider />
        <Txt muted>{t('settings.version', { version: Constants.expoConfig?.version ?? '?' })}</Txt>
        <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
