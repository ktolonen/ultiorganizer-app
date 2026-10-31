import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AUTO_POINT_KEY, parseAutoPoint, type ServerRow } from '../store/repo';
import { getRepo } from '../store/sqlite';
import { Button, Divider, layout, Screen, Txt } from '../ui/components';
import { useThemeMode, type ThemeMode } from '../ui/theme';

const MODES: ThemeMode[] = ['system', 'day', 'night'];

export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [autoPoint, setAutoPoint] = useState(true);

  // Reload on focus so a server paired from here shows up on return.
  useFocusEffect(
    useCallback(() => {
      void getRepo().then(async (repo) => {
        setServers(await repo.listServers());
        setAutoPoint(parseAutoPoint(await repo.getSetting(AUTO_POINT_KEY)));
      });
    }, []),
  );

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
              <Txt key={s.id}>{s.label}</Txt>
            ))}
          </View>
        )}
        <Button label={t('home.pair')} kind="secondary" onPress={() => router.push('/pair')} />

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
        <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
