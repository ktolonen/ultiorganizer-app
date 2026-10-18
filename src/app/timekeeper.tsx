import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButtons, ActionTimerBar, GameClockPanel } from '../timekeeper/ui';
import { useTemplates } from '../timekeeper/useTemplates';
import { useTimekeeper } from '../timekeeper/useTimekeeper';
import { Button, layout, Screen, Txt } from '../ui/components';

/** Timekeeper only: the timer screen with no game and no server. Cached server templates are used when there are any. */
export default function TimekeeperScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const tk = useTimekeeper(useTemplates());
  if (!tk.ready) return <Screen />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.page}>
        <View style={layout.row}>
          <Txt variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {t('timekeeper.title')}
          </Txt>
          <Button
            label={tk.soundOn ? `${t('timekeeper.sound')} ✓` : t('timekeeper.sound')}
            kind="secondary"
            onPress={() => tk.setSoundOn(!tk.soundOn)}
          />
        </View>
        <ActionTimerBar tk={tk} />
        <ActionButtons tk={tk} />
        <GameClockPanel tk={tk} />
        <Txt variant="small" muted>
          {t('timekeeper.notifications')}
        </Txt>
        <Button label={t('common.home')} kind="secondary" onPress={() => router.replace('/')} />
      </ScrollView>
    </Screen>
  );
}
