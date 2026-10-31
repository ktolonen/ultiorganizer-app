import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DiscoveredGame, Discovery } from '../api/http';
import { groupByField } from '../services/games';
import { usePendingLink } from '../services/pending';
import { loadGameList, openFromLink } from '../services/session';
import { Button, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';

export default function Games() {
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const link = usePendingLink((s) => s.link);
  const [data, setData] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!link) return;
    let live = true;
    void loadGameList(link).then((res) => {
      if (!live) return;
      setLoading(false);
      if (res.ok) return setData(res.data);
      setError(
        res.kind === 'http'
          ? t('games.error.http', { code: res.code })
          : res.kind === 'no_server'
            ? t('error.unknown', { code: 'no_server' })
            : t(`games.error.${res.kind}`),
      );
    });
    return () => {
      live = false;
    };
  }, [link, attempt, t]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  };

  const open = async (g: DiscoveredGame) => {
    if (!link) return;
    setOpening(g.game_id);
    const res = await openFromLink(link, g.game_id);
    setOpening(null);
    if (!res.ok) {
      return setError(t(res.error === 'network' ? 'games.error.network' : 'games.error.bad_body'));
    }
    router.push(`/game/${link.serverId}/${g.game_id}`);
  };

  const groups = useMemo(() => groupByField(data?.games ?? []), [data]);
  const resultText = (g: DiscoveredGame) =>
    g.result.state === 'not_started'
      ? t('games.notStarted')
      : `${g.result.home ?? 0} – ${g.result.away ?? 0} · ${t(g.result.state === 'final' ? 'games.final' : 'games.ongoing')}`;

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.scroll}>
        <Txt variant="title" accessibilityRole="header">
          {t('games.title')}
        </Txt>
        {loading && <Txt muted>…</Txt>}
        {error && (
          <>
            <Txt accessibilityRole="alert" style={{ color: palette.signalStop }}>
              {error}
            </Txt>
            <Button label={t('games.retry')} onPress={retry} />
          </>
        )}
        {data && data.games.length === 0 && (
          <Txt>
            {data.available_from
              ? t('games.opensOn', { date: data.available_from })
              : t('games.empty')}
          </Txt>
        )}
        {groups.map(([field, games]) => (
          <View key={field} style={{ gap: 8 }}>
            {field !== '' && <Txt variant="heading">{field}</Txt>}
            {games.map((g) => (
              <Button
                key={g.game_id}
                kind="secondary"
                disabled={opening !== null}
                label={`${(g.time ?? '').slice(11, 16)}  ${g.home.name ?? '?'} – ${g.away.name ?? '?'}`}
                hint={resultText(g)}
                onPress={() => void open(g)}
              />
            ))}
          </View>
        ))}
        <Button label={t('common.home')} kind="secondary" onPress={() => router.replace('/')} />
      </ScrollView>
    </Screen>
  );
}
