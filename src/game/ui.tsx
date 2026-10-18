import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { FONTS, SIZE, SPACE, TARGET, TEAM_SWATCHES, readableOn } from '../ui/tokens';
import { back, initialPicker, pick, stepOf, toggleCallahan } from './goalPicker';
import type { GameState } from './reducer';
import type { RosterEntry, Side } from './types';

const nameOf = (state: GameState, side: Side, id: number | null): string => {
  if (id === null) return '?';
  return state.eligible[side].find((p) => p.player_id === id)?.name ?? `#${id}`;
};

const numberOf = (state: GameState, side: Side, id: number): string => {
  const onRoster = state.rosters[side].find((p) => p.player_id === id);
  return onRoster?.number != null ? String(onRoster.number) : '–';
};

export { nameOf, numberOf };

/** One flooded half of the live screen: team colour, score, timeouts left. */
export function TeamHalf({
  name,
  color,
  points,
  timeoutsLeft,
  timeoutsTotal,
  onPress,
  onMinus,
}: {
  name: string;
  color: string;
  points: number;
  timeoutsLeft: number;
  timeoutsTotal: number;
  onPress: () => void;
  onMinus?: () => void;
}) {
  const { t } = useTranslation();
  const ink = readableOn(color);
  const dots = Array.from({ length: timeoutsTotal }, (_, i) => (i < timeoutsLeft ? '●' : '○')).join(
    '',
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('game.score', { team: name, points, timeouts: timeoutsLeft })}
      onPress={onPress}
      style={[styles.half, { backgroundColor: color }]}
    >
      <Txt variant="heading" numberOfLines={2} style={{ color: ink, textAlign: 'center' }}>
        {name}
      </Txt>
      <Txt
        variant="figure"
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color: ink, fontSize: SIZE.hero, lineHeight: SIZE.hero * 1.05 }}
      >
        {points}
      </Txt>
      <Txt variant="heading" style={{ color: ink }}>
        {t('game.timeouts')} {dots}
      </Txt>
      {onMinus && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="−1"
          onPress={onMinus}
          style={[styles.minus, { borderColor: ink }]}
        >
          <Txt variant="heading" style={{ color: ink }}>
            −1
          </Txt>
        </Pressable>
      )}
    </Pressable>
  );
}

function Chip({
  label,
  onPress,
  selected,
  big,
  color,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  big?: boolean;
  color?: string;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          minHeight: big ? TARGET.live : TARGET.min,
          minWidth: big ? TARGET.live : TARGET.min,
          borderColor: palette.ink,
          backgroundColor: selected ? palette.ink : (color ?? palette.surface),
        },
      ]}
    >
      <Txt
        variant={big ? 'figure' : 'body'}
        style={{
          color: selected ? palette.surface : color ? readableOn(color) : palette.ink,
          fontFamily: big ? FONTS.figures : FONTS.textBold,
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

/** Bottom sheet: tap the assist, then the scorer; the goal saves on the second tap. */
export function GoalSheet({
  visible,
  side,
  teamName,
  state,
  onSave,
  onClose,
}: {
  visible: boolean;
  side: Side;
  teamName: string;
  state: GameState;
  onSave: (goal: { scorerId: number | null; assistId: number | null; callahan: boolean }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [picker, setPicker] = useState(initialPicker);
  const step = stepOf(picker);
  const roster = state.rosters[side];

  const choose = (id: number | null) => {
    const out = pick(picker, id);
    if (out.done) {
      setPicker(initialPicker);
      onSave(out.goal);
    } else setPicker(out.state);
  };
  const close = () => {
    setPicker(initialPicker);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.ink }]}
        >
          <Txt variant="heading" accessibilityRole="header">
            {teamName} · {step === 'assist' ? t('game.pickAssist') : t('game.pickScorer')}
          </Txt>
          <View style={styles.wrap}>
            <Chip
              label={t('term.callahan')}
              selected={picker.callahan}
              onPress={() => setPicker(toggleCallahan(picker))}
            />
            <Chip label={t('term.unknown')} onPress={() => choose(null)} />
            {picker.assist !== undefined && !picker.callahan && (
              <Chip label={t('common.back')} onPress={() => setPicker(back(picker))} />
            )}
          </View>
          <ScrollView>
            <View style={styles.wrap}>
              {roster.map((p) => (
                <Chip
                  key={p.player_id}
                  big
                  label={p.number != null ? String(p.number) : '–'}
                  selected={step === 'scorer' && picker.assist === p.player_id}
                  onPress={() => choose(p.player_id)}
                />
              ))}
            </View>
          </ScrollView>
          <Button label={t('common.cancel')} kind="secondary" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

/** Two team-coloured buttons: which team called it. */
export function TeamPicker({
  visible,
  title,
  names,
  colors,
  disabled,
  hint,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  names: Record<Side, string>;
  colors: Record<Side, string>;
  disabled?: Partial<Record<Side, boolean>>;
  hint?: string;
  onPick: (side: Side) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.ink }]}
        >
          <Txt variant="heading" accessibilityRole="header">
            {title}
          </Txt>
          <View style={styles.wrap}>
            {(['home', 'away'] as const).map((side) => (
              <Pressable
                key={side}
                accessibilityRole="button"
                accessibilityLabel={names[side]}
                accessibilityState={{ disabled: !!disabled?.[side] }}
                disabled={disabled?.[side]}
                onPress={() => onPick(side)}
                style={[
                  styles.teamButton,
                  { backgroundColor: colors[side], opacity: disabled?.[side] ? 0.35 : 1 },
                ]}
              >
                <Txt
                  variant="heading"
                  style={{ color: readableOn(colors[side]), textAlign: 'center' }}
                >
                  {names[side]}
                </Txt>
              </Pressable>
            ))}
          </View>
          {hint && (
            <Txt variant="small" muted>
              {hint}
            </Txt>
          )}
          <Button label={t('common.cancel')} kind="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Rosters: tap a player to toggle, with the jersey number first and C / SC badges. */
export function RosterEditor({
  state,
  side,
  teamName,
  onSave,
}: {
  state: GameState;
  side: Side;
  teamName: string;
  onSave: (players: RosterEntry[]) => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const current = state.rosters[side];
  const on = (id: number) => current.find((p) => p.player_id === id);
  const toggle = (id: number, number: number | null) =>
    onSave(
      on(id)
        ? current.filter((p) => p.player_id !== id)
        : [...current, { player_id: id, number, captain: false, spirit_captain: false }],
    );
  const flag = (id: number, key: 'captain' | 'spirit_captain') =>
    onSave(current.map((p) => (p.player_id === id ? { ...p, [key]: !p[key] } : p)));

  return (
    <View style={{ gap: SPACE.sm }}>
      <Txt variant="heading">{teamName}</Txt>
      {state.eligible[side].map((p) => {
        const entry = on(p.player_id);
        const blocked = state.rules.require_accreditation && p.accredited === false;
        return (
          <View
            key={p.player_id}
            style={[styles.rosterRow, { borderColor: palette.line, opacity: blocked ? 0.45 : 1 }]}
          >
            <Chip
              big
              label={p.number != null ? String(p.number) : '–'}
              selected={!!entry}
              onPress={() => !blocked && toggle(p.player_id, p.number)}
            />
            <View style={{ flex: 1 }}>
              <Txt>{p.name}</Txt>
              {blocked && (
                <Txt variant="small" muted>
                  {t('game.accredited')}
                </Txt>
              )}
            </View>
            {entry && (
              <>
                {/* Approved narrow-table abbreviations from docs/terminology.md; not translated. */}
                <Chip
                  label="C"
                  selected={entry.captain}
                  onPress={() => flag(p.player_id, 'captain')}
                />
                <Chip
                  label="SC"
                  selected={entry.spirit_captain}
                  onPress={() => flag(p.player_id, 'spirit_captain')}
                />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  half: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.md,
    gap: SPACE.sm,
  },
  minus: {
    position: 'absolute',
    right: SPACE.sm,
    top: SPACE.sm,
    minHeight: TARGET.min,
    minWidth: TARGET.min,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '85%',
    borderTopWidth: 2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  chip: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamButton: {
    flex: 1,
    minHeight: TARGET.live * 1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.md,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: SPACE.sm,
  },
});

/** A row of swatches per team; a colour already used by the other team is not offered. */
export function ColorPicker({
  names,
  colors,
  onChange,
}: {
  names: Record<Side, string>;
  colors: Record<Side, string>;
  onChange: (colors: Record<Side, string>) => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: SPACE.md }}>
      {(['home', 'away'] as const).map((side) => {
        const other = colors[side === 'home' ? 'away' : 'home'];
        return (
          <View key={side} style={{ gap: SPACE.xs }}>
            <Txt variant="heading">{names[side]}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
              {TEAM_SWATCHES.map((c) => {
                const selected = colors[side] === c;
                const taken = c === other;
                return (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={c}
                    accessibilityState={{ selected, disabled: taken }}
                    disabled={taken}
                    onPress={() => onChange({ ...colors, [side]: c })}
                    style={{
                      width: TARGET.min,
                      height: TARGET.min,
                      borderRadius: TARGET.min / 2,
                      backgroundColor: c,
                      borderWidth: selected ? 4 : 1,
                      borderColor: selected ? palette.ink : palette.line,
                      opacity: taken ? 0.25 : 1,
                    }}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
