import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  CAP_TYPES,
  cleanOfficial,
  currentScore,
  timeoutsLeft,
  type CapType,
  type GameEvent,
} from '../../../game/reducer';
import type { Side } from '../../../game/types';
import {
  CapSheet,
  ColorPicker,
  GoalSheet,
  nameOf,
  numberOf,
  RosterEditor,
  ScorekeeperField,
  TeamHalf,
  TeamPicker,
} from '../../../game/ui';
import { useGame, type ActionError } from '../../../game/useGame';
import { isLocalGame } from '../../../game/local';
import { AUTO_POINT_KEY, gameScope, parseAutoPoint, SCOREKEEPER_KEY } from '../../../store/repo';
import { getRepo } from '../../../store/sqlite';
import { isFullySynced, unsentRows } from '../../../sync/outbox';
import { ActionButtons, ActionTimerBar, formatTime, GameClockPanel } from '../../../timekeeper/ui';
import { useTemplates } from '../../../timekeeper/useTemplates';
import { useTimekeeper } from '../../../timekeeper/useTimekeeper';
import { Button, Divider, layout, Screen, Txt } from '../../../ui/components';
import { SyncDot } from '../../../ui/SyncDot';
import { useTheme } from '../../../ui/theme';
import { SPACE, TARGET } from '../../../ui/tokens';

type Tab = 'live' | 'sheet' | 'rosters' | 'finish';
// 'offence' asks at the first Start of half; 'offenceEdit' only corrects the saved value.
type Asking = null | 'timeout' | 'spirit' | 'offence' | 'offenceEdit';

export default function GameScreen() {
  const params = useLocalSearchParams<{ serverId: string; gameId: string }>();
  const serverId = Number(params.serverId);
  const gameId = Number(params.gameId);
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const game = useGame(serverId, gameId);
  const tk = useTimekeeper(
    // A local game has no server of its own: use whichever server templates are cached.
    useTemplates(isLocalGame(serverId) ? undefined : serverId),
    gameScope(serverId, gameId),
  );
  const [tab, setTab] = useState<Tab>('live');
  const [goalSide, setGoalSide] = useState<Side | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [capOpen, setCapOpen] = useState<CapType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autoPoint, setAutoPoint] = useState(true);
  const [savedName, setSavedName] = useState<string | null>(null);
  useEffect(() => {
    void getRepo().then(async (r) => {
      setAutoPoint(parseAutoPoint(await r.getSetting(AUTO_POINT_KEY)));
      setSavedName(cleanOfficial((await r.getSetting(SCOREKEEPER_KEY)) ?? ''));
    });
  }, []);

  // A game with no scorekeeper gets the name from Settings, once per opening. A name already
  // on the game (set on the server or here) is never replaced.
  const nameFilled = useRef(false);
  const loadedState = game.session?.state;
  useEffect(() => {
    if (nameFilled.current || !loadedState || savedName === null) return;
    nameFilled.current = true;
    if (savedName && loadedState.official === null && loadedState.result?.state !== 'final') {
      game.apply({ type: 'metadata', official: savedName });
    }
  }, [loadedState, savedName, game]);

  if (!game.loaded || !game.session || !tk.ready) return <Screen />;
  const { state, context, outbox } = game.session;
  const names: Record<Side, string> = {
    home: context.home.name ?? t('common.home'),
    away: context.away.name ?? t('common.away'),
  };
  const score = currentScore(state);
  const clockSeconds = Math.round(tk.clockSeconds);
  const hideTimes = state.rules.hide_time_on_scoresheet;
  const isFinal = state.result?.state === 'final';
  // Kept on this phone only: nothing syncs, and there are no players to put on rosters.
  const local = isLocalGame(serverId);

  const report = (err: ActionError | null): boolean => {
    setMessage(
      err ? t(`error.${err.code}`, { defaultValue: t('error.unknown', { code: err.code }) }) : null,
    );
    return err === null;
  };
  const apply = (event: GameEvent) => report(game.apply(event));

  const hasRoster = (side: Side) => state.rosters[side].length > 0;

  const bothRostersEmpty = !hasRoster('home') && !hasRoster('away');

  // Result-only keeping (no rosters at all) counts points with score taps. Once either side
  // has a roster every point is a goal: mixing taps and goals would leave a result that no
  // longer equals the goal total, and a whole-game upload would be refused.
  const tapScore = (side: Side) => {
    if (isFinal) return;
    if (bothRostersEmpty) apply({ type: 'score_tap', side, delta: 1 });
    else if (hasRoster(side)) setGoalSide(side);
    else saveGoal({ scorerId: null, assistId: null, callahan: false }, side); // Unknown, Unknown
  };

  // −1 takes back what +1 added: a score tap in result-only keeping, otherwise the last
  // goal, and only from the side that scored it.
  const minusFor = (side: Side): (() => void) | undefined => {
    if (isFinal || score[side] <= 0) return undefined;
    if (bothRostersEmpty) return () => apply({ type: 'score_tap', side, delta: -1 });
    if (state.goals[state.goals.length - 1]?.side !== side) return undefined;
    return () => report(game.undoGoal());
  };

  const saveGoal = (
    goal: { scorerId: number | null; assistId: number | null; callahan: boolean },
    side: Side | null = goalSide,
  ) => {
    setGoalSide(null);
    if (!side) return;
    const ok = apply({
      type: 'goal',
      side,
      ...goal,
      time: hideTimes ? null : clockSeconds,
    });
    // A recorded goal starts the Start of point timer.
    if (ok && autoPoint) tk.start('betweenpoints');
  };

  const onAction = (id: Parameters<typeof tk.start>[0]) => {
    if (id === 'timeout') return setAsking('timeout');
    if (id === 'halfstart') {
      // Starting offence is a game fact, asked once. Later halves just start the timer;
      // a wrong pick is corrected on the Sheet tab.
      if (state.startingOffence === null) return setAsking('offence');
      tk.start('halfstart');
      return;
    }
    if (id === 'halftime') {
      tk.start('halftime');
      apply({ type: 'metadata', halftime: clockSeconds });
      return;
    }
    tk.start(id);
  };

  const onPick = (side: Side) => {
    const kind = asking;
    setAsking(null);
    if (kind === 'timeout') {
      if (apply({ type: 'timeout', side, time: clockSeconds })) tk.start('timeout');
    } else if (kind === 'spirit') {
      if (
        apply({ type: 'spirit_stoppage', side, time: clockSeconds }) &&
        tk.session.clock.running
      ) {
        tk.pauseClock();
      }
    } else if (kind === 'offence') {
      if (apply({ type: 'metadata', startingOffence: side })) tk.start('halfstart');
    } else if (kind === 'offenceEdit') {
      if (state.startingOffence !== side) apply({ type: 'metadata', startingOffence: side });
    }
  };

  const goalLine = (g: (typeof state.goals)[number]) => {
    const scorer =
      g.scorerId !== null
        ? `${numberOf(state, g.side, g.scorerId)} ${nameOf(state, g.side, g.scorerId)}`
        : '?';
    const assist = g.callahan
      ? t('term.callahan')
      : g.assistId !== null
        ? nameOf(state, g.side, g.assistId)
        : '?';
    return `${g.num}. ${g.homeScore}–${g.awayScore}  ${scorer} ← ${assist}${g.time !== null ? `  ${formatTime(g.time)}` : ''}`;
  };

  const capName = (cap: CapType) =>
    cap === 'half_cap' ? t('term.halftimeCap') : t('term.timeCap');
  // The timekeeper's cap notice offers to record the cap it announces, unless it is recorded
  // already. Events that hide times record no caps, as on the server.
  const noticeCap: CapType | null = hideTimes
    ? null
    : tk.caps.active === 'time'
      ? 'time_cap'
      : tk.caps.active === 'half'
        ? 'half_cap'
        : null;
  const offerCap = noticeCap && !state.caps[noticeCap] ? noticeCap : null;

  const synced = isFullySynced(outbox);
  const failedRow = outbox.rows.find((r) => r.status === 'failed');

  return (
    <Screen>
      <View style={[layout.row, styles.header]}>
        <Txt variant="small" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
          {game.session.title}
        </Txt>
        {local ? (
          <Txt variant="small" muted>
            {t('home.localOnly')}
          </Txt>
        ) : (
          <SyncDot status={game.status} />
        )}
      </View>
      <View style={[layout.row, styles.tabs]}>
        {(local
          ? (['live', 'sheet', 'finish'] as const)
          : (['live', 'sheet', 'rosters', 'finish'] as const)
        ).map((id) => (
          <View key={id} style={{ flex: 1 }}>
            <Button
              label={t(`game.tab.${id}`)}
              kind={tab === id ? 'primary' : 'secondary'}
              onPress={() => setTab(id)}
            />
          </View>
        ))}
      </View>

      {message && (
        <Txt
          accessibilityRole="alert"
          style={{ color: palette.signalStop, paddingHorizontal: SPACE.lg }}
        >
          {message}
        </Txt>
      )}
      {game.offerUpload && !local && (
        <View style={{ paddingHorizontal: SPACE.lg }}>
          <Button
            label={t('game.uploadAll')}
            kind="secondary"
            onPress={() => report(game.uploadWholeGame())}
          />
        </View>
      )}

      {tab === 'live' && (
        <View style={{ flex: 1 }}>
          <View style={styles.clockRow}>
            <GameClockPanel tk={tk} compact />
            {offerCap && (
              <Button
                label={t('game.recordCap')}
                kind="secondary"
                onPress={() => setCapOpen(offerCap)}
              />
            )}
          </View>
          <View style={styles.halves}>
            {(['home', 'away'] as const).map((side) => (
              <TeamHalf
                key={side}
                name={names[side]}
                color={game.colors[side]}
                points={score[side]}
                timeoutsLeft={timeoutsLeft(state, side)}
                timeoutsTotal={state.rules.timeouts_per_team}
                onPlus={isFinal ? undefined : () => tapScore(side)}
                onMinus={minusFor(side)}
              />
            ))}
          </View>
          {bothRostersEmpty && !local && (
            <Txt variant="small" muted style={{ paddingHorizontal: SPACE.lg }}>
              {t('game.noRoster')}
            </Txt>
          )}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.controls}>
            <ActionTimerBar tk={tk} compact />
            <ActionButtons
              tk={tk}
              onAction={onAction}
              actions={[
                'betweenpoints',
                'timeout',
                'halfstart',
                'halftime',
                'dispute',
                'discretrieval',
              ]}
            />
            {state.rules.spirit_stoppages_enabled && (
              <Button
                label={t('game.spirit')}
                kind="secondary"
                size="live"
                onPress={() => setAsking('spirit')}
              />
            )}
          </ScrollView>
        </View>
      )}

      {tab === 'sheet' && (
        <ScrollView contentContainerStyle={layout.scroll}>
          <Button
            label={t('game.undo')}
            kind="secondary"
            disabled={state.goals.length === 0 || isFinal}
            onPress={() => report(game.undoGoal())}
          />
          {state.goals.map((g) => (
            <Txt key={g.num}>{goalLine(g)}</Txt>
          ))}
          <Divider />
          {(['home', 'away'] as const).map((side) => (
            <View key={side} style={{ gap: 4 }}>
              <Txt variant="heading">
                {names[side]} · {t('term.timeout')}:{' '}
                {state.timeouts[side].map((x) => formatTime(x.time)).join(', ') || '–'}
              </Txt>
              {state.timeouts[side].map((x, i) => (
                <Button
                  key={`${i}-${x.time}`}
                  label={`${t('game.removeTimeout')} ${formatTime(x.time)}`}
                  kind="secondary"
                  onPress={() => apply({ type: 'remove_timeout', side, index: i })}
                />
              ))}
              {state.rules.spirit_stoppages_enabled && (
                <Txt muted>
                  {t('term.spiritStoppage')}:{' '}
                  {state.spiritStoppages[side].map((x) => formatTime(x.time)).join(', ') || '–'}
                </Txt>
              )}
            </View>
          ))}
          <Divider />
          <Txt variant="heading">{t('game.colors')}</Txt>
          <ColorPicker names={names} colors={game.colors} onChange={game.setColors} />
          <Divider />
          <Txt muted>
            {t('term.startingOffence')}:{' '}
            {state.startingOffence ? names[state.startingOffence] : '–'}
          </Txt>
          <Button
            label={t('game.changeOffence')}
            kind="secondary"
            disabled={isFinal}
            onPress={() => setAsking('offenceEdit')}
          />
          <Txt muted>
            {t('term.halftime')}: {state.halftime !== null ? formatTime(state.halftime) : '–'}
          </Txt>
          {!hideTimes && (
            <>
              <Divider />
              {CAP_TYPES.map((cap) => {
                const c = state.caps[cap];
                return (
                  <View key={cap} style={{ gap: 4 }}>
                    <Txt muted>
                      {capName(cap)}:{' '}
                      {c
                        ? t('game.capLine', { time: formatTime(c.time), points: c.pointCap })
                        : t('game.capNone')}
                    </Txt>
                    <Button
                      label={c ? t('game.capEdit') : t('game.recordCap')}
                      kind="secondary"
                      onPress={() => setCapOpen(cap)}
                    />
                  </View>
                );
              })}
              {outbox.capsAbsent && (
                <Txt variant="small" muted>
                  {t('game.capsLocal')}
                </Txt>
              )}
            </>
          )}
          <Divider />
          <ScorekeeperField
            key={state.official ?? ''}
            value={state.official}
            disabled={isFinal}
            onSave={(official) => apply({ type: 'metadata', official })}
          />
        </ScrollView>
      )}

      {tab === 'rosters' && (
        <ScrollView contentContainerStyle={layout.scroll}>
          {(['home', 'away'] as const).map((side) => (
            <RosterEditor
              key={side}
              state={state}
              side={side}
              teamName={names[side]}
              onSave={(players) => apply({ type: 'roster', side, players })}
            />
          ))}
        </ScrollView>
      )}

      {tab === 'finish' && (
        <ScrollView contentContainerStyle={layout.scroll}>
          <Txt variant="title">
            {names.home} {score.home} – {score.away} {names.away}
          </Txt>
          {local ? <Txt muted>{t('game.localNote')}</Txt> : <SyncDot status={game.status} />}
          {isFinal && !synced && !local && <Txt>{t('game.notSynced')}</Txt>}
          <Button
            label={t('game.finalize')}
            disabled={isFinal || state.result === null}
            onPress={() => setConfirmFinal(true)}
          />
          {unsentRows(outbox).length > 0 && (
            <Button label={t('game.syncNow')} kind="secondary" onPress={game.syncNow} />
          )}
          {outbox.paused?.reason === 'auth' && (
            <Button label={t('game.resumeAuth')} kind="secondary" onPress={game.resumeAuth} />
          )}
        </ScrollView>
      )}

      <Button label={t('common.home')} kind="secondary" onPress={() => router.replace('/')} />

      <GoalSheet
        visible={goalSide !== null}
        side={goalSide ?? 'home'}
        teamName={goalSide ? names[goalSide] : ''}
        state={state}
        onSave={saveGoal}
        onClose={() => setGoalSide(null)}
      />

      {capOpen && (
        <CapSheet
          cap={capOpen}
          state={state}
          clockSeconds={clockSeconds}
          onSave={(c) => {
            const cap = capOpen;
            setCapOpen(null);
            if (apply({ type: 'cap', cap, ...c }) && noticeCap === cap) {
              tk.dismissCap(cap === 'time_cap' ? 'time' : 'half');
            }
          }}
          onRemove={() => {
            const cap = capOpen;
            setCapOpen(null);
            apply({ type: 'remove_cap', cap });
          }}
          onClose={() => setCapOpen(null)}
        />
      )}

      <TeamPicker
        visible={asking !== null}
        title={
          asking === 'timeout'
            ? t('term.timeout')
            : asking === 'spirit'
              ? t('term.spiritStoppage')
              : t('term.startingOffence')
        }
        names={names}
        colors={game.colors}
        disabled={
          asking === 'timeout'
            ? { home: timeoutsLeft(state, 'home') === 0, away: timeoutsLeft(state, 'away') === 0 }
            : undefined
        }
        hint={
          asking === 'timeout' &&
          (timeoutsLeft(state, 'home') === 0 || timeoutsLeft(state, 'away') === 0)
            ? t('game.noTimeoutsLeft')
            : undefined
        }
        onPick={onPick}
        onClose={() => setAsking(null)}
      />

      <Modal
        visible={confirmFinal}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmFinal(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.ink }]}
          >
            <Txt variant="heading">
              {t('game.confirmFinal', { home: score.home, away: score.away })}
            </Txt>
            <Button
              label={t('game.finalize')}
              onPress={() => {
                setConfirmFinal(false);
                apply({ type: 'finalize' });
              }}
            />
            <Button
              label={t('common.cancel')}
              kind="secondary"
              onPress={() => setConfirmFinal(false)}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={game.conflict !== null || failedRow !== undefined}
        transparent
        animationType="slide"
      >
        <View style={styles.backdrop}>
          <View
            style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.ink }]}
          >
            <Txt variant="heading" accessibilityRole="header">
              {t('game.conflict.title')}
            </Txt>
            {failedRow?.error && (
              <Txt style={{ color: palette.signalStop }}>
                {t(`error.${failedRow.error.code}`, { defaultValue: failedRow.error.message })}
              </Txt>
            )}
            {message && <Txt style={{ color: palette.signalStop }}>{message}</Txt>}
            <Txt>
              {t('game.conflict.phone')}: {score.home} – {score.away}
            </Txt>
            {game.conflict && (
              <Txt>
                {t('game.conflict.server')}: {game.conflict.fresh.result?.home ?? 0} –{' '}
                {game.conflict.fresh.result?.away ?? 0}
              </Txt>
            )}
            <Button
              label={t('game.conflict.keepServer')}
              onPress={game.keepServer}
              disabled={!game.conflict}
            />
            <Button
              label={t('game.conflict.uploadMine')}
              kind="secondary"
              onPress={() => report(game.uploadMine())}
              disabled={!game.conflict}
            />
            {failedRow && (
              <Button
                label={t('game.retry')}
                kind="secondary"
                onPress={() => game.retry(failedRow.key)}
              />
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm },
  tabs: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
  clockRow: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
  halves: { flexDirection: 'row' },
  controls: { padding: SPACE.lg, gap: SPACE.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopWidth: 2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SPACE.lg,
    gap: SPACE.md,
    minHeight: TARGET.live * 2,
  },
});
