import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_LOCAL_TIMEOUTS,
  LOCAL_SERVER_ID,
  MAX_TEAM_NAME,
  newLocalSession,
} from '../game/local';
import { gameTitle } from '../services/games';
import { getRepo } from '../store/sqlite';
import { Button, layout, Screen, TextField, Txt } from '../ui/components';
import { defaultTeamColors, SIZE } from '../ui/tokens';

/**
 * Starts a game kept on this phone only: a backup for a game the server does not know.
 * It is never linked to a server game and never uploaded.
 */
export default function LocalGame() {
  const { t } = useTranslation();
  const router = useRouter();
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [field, setField] = useState('');
  const [timeouts, setTimeouts] = useState(DEFAULT_LOCAL_TIMEOUTS);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const repo = await getRepo();
      const gameId = await repo.nextGameId(LOCAL_SERVER_ID);
      const input = {
        home: home || t('common.home'),
        away: away || t('common.away'),
        field,
        timeoutsPerTeam: timeouts,
      };
      const now = Date.now();
      const draft = newLocalSession(gameId, '', input, now);
      const title = gameTitle({
        field: draft.context.game.field,
        home: { name: draft.context.home.name },
        away: { name: draft.context.away.name },
      });
      const session = { ...draft, title };
      await repo.saveGame({ ...session, colors: defaultTeamColors(gameId), now });
      router.replace(`/game/${LOCAL_SERVER_ID}/${gameId}`);
    } finally {
      setBusy(false);
    }
  };

  const nameField = (label: string, value: string, set: (v: string) => void) => (
    <View style={{ gap: 4 }}>
      <Txt muted>{label}</Txt>
      <TextField
        value={value}
        onChangeText={set}
        maxLength={MAX_TEAM_NAME}
        autoCapitalize="words"
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.scroll} keyboardShouldPersistTaps="handled">
        <Txt variant="title" accessibilityRole="header">
          {t('local.title')}
        </Txt>
        <Txt muted>{t('local.body')}</Txt>
        {nameField(t('local.home'), home, setHome)}
        {nameField(t('local.away'), away, setAway)}
        {nameField(t('local.field'), field, setField)}
        <View style={{ gap: 4 }}>
          <Txt muted>{t('local.timeouts')}</Txt>
          <View style={layout.row}>
            <View style={{ flex: 1 }}>
              <Button
                label="−1"
                kind="secondary"
                disabled={timeouts <= 0}
                onPress={() => setTimeouts((n) => Math.max(0, n - 1))}
              />
            </View>
            <Txt
              variant="figure"
              accessibilityLabel={`${t('local.timeouts')} ${timeouts}`}
              style={{ fontSize: SIZE.lg, minWidth: 48, textAlign: 'center' }}
            >
              {timeouts}
            </Txt>
            <View style={{ flex: 1 }}>
              <Button
                label="+1"
                kind="secondary"
                disabled={timeouts >= 9}
                onPress={() => setTimeouts((n) => Math.min(9, n + 1))}
              />
            </View>
          </View>
        </View>
        <Button label={t('local.start')} disabled={busy} onPress={() => void start()} />
        <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
