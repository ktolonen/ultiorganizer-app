import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signalText } from '../i18n';
import { Button, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { FONTS, SIZE, SPACE, readableOn, TARGET } from '../ui/tokens';
import type { TimekeeperApi } from './useTimekeeper';
import type { ActionId } from './templates';

export const formatTime = (totalSeconds: number): string => {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(Math.floor(totalSeconds));
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Most-used action first, as on the web Timekeeper. */
export const ACTION_ORDER: readonly ActionId[] = [
  'betweenpoints',
  'timeout',
  'halfstart',
  'halftime',
  'dispute',
  'discretrieval',
];

/** The action timer bar: fills the width and changes colour at each signal (go, warn, stop). */
export function ActionTimerBar({ tk, compact }: { tk: TimekeeperApi; compact?: boolean }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const view = tk.view;
  const fill = !view
    ? palette.surface
    : view.state === 'zero'
      ? palette.signalStop
      : view.state === 'warn'
        ? palette.signalWarn
        : palette.signalGo;
  const ink = view ? readableOn(fill) : palette.ink;
  // The game screen uses a smaller timer so the action buttons fit without scrolling.
  const timerSize = compact ? SIZE.xl : SIZE.score;
  const paused = tk.session.timer?.pausedAtMs != null;
  const scenarioId = tk.session.timer?.scenario.id;
  const label = view
    ? `${t(`timekeeper.action.${scenarioId}`)}, ${formatTime(view.remaining)}${view.signalText ? `, ${signalText(view.signalText)}` : ''}`
    : t('timekeeper.noTimer');
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={label}
      style={[
        styles.bar,
        compact && styles.barCompact,
        { backgroundColor: fill, borderColor: palette.ink },
      ]}
    >
      <Txt variant="small" style={{ color: ink }}>
        {view ? t(`timekeeper.action.${scenarioId}`) : t('timekeeper.noTimer')}
        {paused ? ' · ⏸' : ''}
      </Txt>
      <Txt variant="figure" style={{ color: ink, fontSize: timerSize, lineHeight: timerSize }}>
        {formatTime(view?.remaining ?? 0)}
      </Txt>
      {/* The signal text repeats the colour state: colour is never the only signal. */}
      <Txt
        variant={compact ? 'body' : 'heading'}
        style={{ color: ink, minHeight: compact ? 20 : 28 }}
      >
        {view?.signalText ? signalText(view.signalText) : ' '}
      </Txt>
      {tk.next && view?.state !== 'zero' && (
        <Txt variant="small" style={{ color: ink }}>
          {t('timekeeper.next', {
            text: `${signalText(tk.next.text)} ${formatTime(tk.next.inSeconds)}`,
          })}
        </Txt>
      )}
    </View>
  );
}

export function ActionButtons({
  tk,
  actions = ACTION_ORDER,
  onAction,
}: {
  tk: TimekeeperApi;
  actions?: readonly ActionId[];
  /** Lets a screen intercept an action (the game screen asks which team called a timeout). */
  onAction?: (id: ActionId) => void;
}) {
  const { t } = useTranslation();
  const running = !!tk.session.timer;
  const paused = tk.session.timer?.pausedAtMs != null;
  return (
    <View style={styles.grid}>
      {actions.map((id) => (
        <View key={id} style={styles.cell}>
          <Button
            label={t(`timekeeper.action.${id}`)}
            kind="secondary"
            size="live"
            onPress={() => (onAction ? onAction(id) : tk.start(id))}
          />
        </View>
      ))}
      <View style={styles.cell}>
        <Button
          label={paused ? t('timekeeper.resume') : t('timekeeper.pause')}
          kind="secondary"
          disabled={!running}
          onPress={tk.pauseResume}
        />
      </View>
      <View style={styles.cell}>
        <Button
          label={t('timekeeper.stop')}
          kind="secondary"
          disabled={!running}
          onPress={tk.stop}
        />
      </View>
    </View>
  );
}

export function GameClockPanel({ tk, compact }: { tk: TimekeeperApi; compact?: boolean }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const { clock } = tk.session;
  const started = clock.running || clock.accumMs > 0;
  const capText =
    tk.caps.active === 'time'
      ? t('timekeeper.capTime')
      : tk.caps.active === 'half'
        ? t('timekeeper.capHalf')
        : null;
  // Yellow at the halftime cap, red at the time cap or when an action started with the clock stopped.
  const fill =
    tk.caps.active === 'time' || tk.session.startWarning
      ? palette.signalStop
      : tk.caps.active === 'half'
        ? palette.signalWarn
        : palette.surface;
  const ink = fill === palette.surface ? palette.ink : readableOn(fill);
  const notices = (
    <>
      {tk.session.startWarning && !clock.running && (
        <Txt variant="heading" style={{ color: ink }}>
          {t('timekeeper.clockMissed')}
        </Txt>
      )}
      {capText && tk.caps.active && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${capText}. ${t('timekeeper.dismiss')}`}
          onPress={() => tk.dismissCap(tk.caps.active!)}
          style={{ minHeight: TARGET.min, justifyContent: 'center' }}
        >
          <Txt variant="heading" style={{ color: ink }}>
            {capText} · {t('timekeeper.dismiss')}
          </Txt>
        </Pressable>
      )}
    </>
  );

  // Live game screen: a plain text line, no border, so it reads as information and not as
  // another button row. Pause is rarely needed, so it is a small text link. The fill colour
  // still appears behind the line at a cap or a missed start.
  if (compact) {
    const link = clock.running
      ? { label: t('timekeeper.pause'), onPress: tk.pauseClock }
      : {
          label: started ? t('timekeeper.resumeClock') : t('timekeeper.startClock'),
          onPress: tk.startClock,
        };
    return (
      <View
        style={[
          styles.clockLine,
          fill !== palette.surface && { backgroundColor: fill, borderRadius: 8 },
        ]}
      >
        <View style={styles.clockInline}>
          <View
            accessible
            accessibilityLabel={`${t('timekeeper.gameClock')} ${formatTime(tk.clockSeconds)}`}
            style={styles.clockInline}
          >
            <Txt variant="small" style={{ color: ink }}>
              {t('timekeeper.gameClock')}
            </Txt>
            <Txt variant="figure" style={{ color: ink, fontSize: SIZE.md }}>
              {formatTime(tk.clockSeconds)}
            </Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={link.label}
            onPress={link.onPress}
            hitSlop={{ top: 14, bottom: 14 }}
            style={styles.clockLink}
          >
            <Txt variant="small" style={{ color: ink, textDecorationLine: 'underline' }}>
              {link.label}
            </Txt>
          </Pressable>
        </View>
        {notices}
      </View>
    );
  }

  return (
    <View style={[styles.clock, { backgroundColor: fill, borderColor: palette.ink }]}>
      <View style={styles.clockRow}>
        <View
          accessible
          accessibilityLabel={`${t('timekeeper.gameClock')} ${formatTime(tk.clockSeconds)}`}
        >
          <Txt variant="small" style={{ color: ink }}>
            {t('timekeeper.gameClock')}
          </Txt>
          <Txt variant="figure" style={{ color: ink }}>
            {formatTime(tk.clockSeconds)}
          </Txt>
        </View>
        <View style={{ flex: 1, gap: SPACE.sm }}>
          {clock.running ? (
            <View style={styles.clockButtons}>
              <View style={{ flex: 1 }}>
                <Button label={t('timekeeper.mark')} kind="secondary" onPress={tk.mark} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={t('timekeeper.pause')} kind="secondary" onPress={tk.pauseClock} />
              </View>
            </View>
          ) : (
            <Button
              label={started ? t('timekeeper.resumeClock') : t('timekeeper.startClock')}
              onPress={tk.startClock}
            />
          )}
        </View>
      </View>
      {notices}
      {tk.session.marks.length > 0 && (
        <ScrollView style={{ maxHeight: 140 }}>
          {[...tk.session.marks].reverse().map((m, i) => (
            <View key={`${m.key}-${m.number}-${i}`} style={styles.markRow}>
              <Txt variant="small" style={{ color: ink }}>
                {m.label} {m.number}
              </Txt>
              <Txt variant="small" style={{ color: ink, fontFamily: FONTS.figuresSemi }}>
                {formatTime(m.seconds)}
              </Txt>
            </View>
          ))}
        </ScrollView>
      )}
      {started && <Button label={t('timekeeper.reset')} kind="secondary" onPress={tk.resetClock} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: 2, borderRadius: 12, padding: SPACE.lg, alignItems: 'center', gap: 2 },
  barCompact: { paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, gap: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  cell: { width: '48%', flexGrow: 1 },
  clock: { borderWidth: 2, borderRadius: 12, padding: SPACE.md, gap: SPACE.sm },
  clockLine: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, gap: SPACE.xs },
  clockInline: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm },
  clockLink: { marginLeft: 'auto', paddingHorizontal: SPACE.sm },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  clockButtons: { flexDirection: 'row', gap: SPACE.sm },
  markRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
});
