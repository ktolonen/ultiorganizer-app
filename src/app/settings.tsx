import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, type ImageSourcePropType, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { cleanOfficial, MAX_OFFICIAL_LENGTH } from '../game/reducer';
import {
  LANGUAGE_KEY,
  LANGUAGE_NAMES,
  LANGUAGES,
  type Language,
  type LanguagePref,
  parseLanguagePref,
  setLanguage,
} from '../i18n';
import { AUTO_POINT_KEY, parseAutoPoint, SCOREKEEPER_KEY, type ServerRow } from '../store/repo';
import { deleteAppToken, deleteLinkToken, deleteSavedLinkToken } from '../store/secure';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, TextField, Txt } from '../ui/components';
import { useTheme, useThemeMode, type ThemeMode } from '../ui/theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

// The flags of the server's own language menu (ultiorganizer images/flags/medium).
const FLAGS: Record<Language, { source: ImageSourcePropType; aspect: number }> = {
  en: { source: require('../../assets/images/flags/en.png'), aspect: 235 / 117 },
  fi: { source: require('../../assets/images/flags/fi.png'), aspect: 235 / 139 },
  de: { source: require('../../assets/images/flags/de.png'), aspect: 236 / 157 },
  es: { source: require('../../assets/images/flags/es.png'), aspect: 235 / 153 },
};

function Flag({ lang }: { lang: Language }) {
  const { palette } = useTheme();
  return (
    <Image
      source={FLAGS[lang].source}
      accessible={false}
      style={{
        // Both sides explicit: Android sizes an image by its file when only one is given.
        height: 18,
        width: Math.round(18 * FLAGS[lang].aspect),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.line,
      }}
    />
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [autoPoint, setAutoPoint] = useState(true);
  const [scorekeeper, setScorekeeper] = useState('');
  const [language, setLanguagePref] = useState<LanguagePref>('system');

  // Reload on focus so a server paired from here shows up on return.
  useFocusEffect(
    useCallback(() => {
      void getRepo().then(async (repo) => {
        setServers(await repo.listServers());
        setAutoPoint(parseAutoPoint(await repo.getSetting(AUTO_POINT_KEY)));
        setScorekeeper((await repo.getSetting(SCOREKEEPER_KEY)) ?? '');
        setLanguagePref(parseLanguagePref(await repo.getSetting(LANGUAGE_KEY)));
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

  const chooseLanguage = async (pref: LanguagePref) => {
    setLanguagePref(pref);
    setLanguage(pref);
    await (await getRepo()).setSetting(LANGUAGE_KEY, pref);
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
          {t('settings.language')}
        </Txt>
        <Button
          label={t('settings.language.system')}
          kind={language === 'system' ? 'primary' : 'secondary'}
          onPress={() => void chooseLanguage('system')}
        />
        {/* Two per row; each language is named in itself, so the way back is always readable. */}
        {[LANGUAGES.slice(0, 2), LANGUAGES.slice(2)].map((pair) => (
          <View key={pair.join()} style={layout.row}>
            {pair.map((lang) => (
              <View key={lang} style={{ flex: 1 }}>
                <Button
                  label={LANGUAGE_NAMES[lang]}
                  icon={<Flag lang={lang} />}
                  kind={language === lang ? 'primary' : 'secondary'}
                  onPress={() => void chooseLanguage(lang)}
                />
              </View>
            ))}
          </View>
        ))}

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
