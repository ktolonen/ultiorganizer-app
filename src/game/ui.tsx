import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, TextField, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { FONTS, SIZE, SPACE, TARGET, TEAM_SWATCHES, readableOn } from '../ui/tokens';
import { back, initialPicker, pick, stepOf, toggleCallahan } from './goalPicker';
import {
  cleanOfficial,
  currentScore,
  MAX_CAP_TIME,
  MAX_NOTE_BYTES,
  MAX_OFFICIAL_LENGTH,
  utf8Bytes,
  MAX_POINT_CAP,
  minPointCap,
  suggestedPointCap,
  type CapType,
  type GameState,
} from './reducer';
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

/** One flooded half of the live screen: team colour, score, timeouts left, and ±1 buttons. */
// Smaller than SIZE.score so the action buttons below get the room.
const SCORE_SIZE = 64;

export function TeamHalf({
  name,
  color,
  points,
  timeoutsLeft,
  timeoutsTotal,
  onPlus,
  onMinus,
}: {
  name: string;
  color: string;
  points: number;
  timeoutsLeft: number;
  timeoutsTotal: number;
  /** Omitted when the score cannot be raised (game final). */
  onPlus?: () => void;
  /** Omitted when this side has nothing to take back. */
  onMinus?: () => void;
}) {
  const { t } = useTranslation();
  const ink = readableOn(color);
  const dots = Array.from({ length: timeoutsTotal }, (_, i) => (i < timeoutsLeft ? '●' : '○')).join(
    '',
  );
  const step = (label: string, a11y: string, onPress?: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.step, { borderColor: ink, opacity: onPress ? 1 : 0.35 }]}
    >
      <Txt
        variant="figure"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ color: ink, fontSize: SIZE.lg }}
      >
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <View
      accessible
      accessibilityLabel={t('game.score', { team: name, points, timeouts: timeoutsLeft })}
      style={[styles.half, { backgroundColor: color }]}
    >
      <Txt variant="heading" numberOfLines={2} style={{ color: ink, textAlign: 'center' }}>
        {name}
      </Txt>
      <Txt
        variant="figure"
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color: ink, fontSize: SCORE_SIZE, lineHeight: SCORE_SIZE * 1.05 }}
      >
        {points}
      </Txt>
      <Txt variant="small" style={{ color: ink }}>
        {t('game.timeouts')} {dots}
      </Txt>
      <View style={styles.steps}>
        {step('−1', t('game.removePoint', { team: name }), onMinus)}
        {step('+1', t('game.addPoint', { team: name }), onPlus)}
      </View>
    </View>
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
          height: big ? TARGET.live : TARGET.min,
          minWidth: big ? TARGET.live : TARGET.min,
          borderColor: palette.ink,
          backgroundColor: selected ? palette.ink : (color ?? palette.surface),
        },
      ]}
    >
      <Txt
        variant={big ? 'figure' : 'body'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
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

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function Stepper({
  label,
  value,
  steps,
  onChange,
}: {
  label: string;
  value: string;
  steps: { label: string; delta: number; disabled?: boolean }[];
  onChange: (delta: number) => void;
}) {
  const half = Math.ceil(steps.length / 2);
  const cell = (st: (typeof steps)[number]) => (
    <View key={st.label} style={{ flex: 1 }}>
      <Button
        label={st.label}
        kind="secondary"
        disabled={st.disabled}
        onPress={() => onChange(st.delta)}
      />
    </View>
  );
  return (
    <View style={{ gap: 4 }}>
      <Txt muted>{label}</Txt>
      <View style={styles.stepper}>
        {steps.slice(0, half).map(cell)}
        <Txt
          variant="figure"
          accessibilityLabel={`${label} ${value}`}
          style={{ fontSize: SIZE.lg, minWidth: 72, textAlign: 'center' }}
        >
          {value}
        </Txt>
        {steps.slice(half).map(cell)}
      </View>
    </View>
  );
}

/**
 * Records a halftime cap or time cap, or corrects the recorded one, like the Scorekeeper
 * cap page: the time it was called and the new point cap, which for a new cap starts one
 * above the higher score. Render it only while open, so each opening starts fresh.
 */
export function CapSheet({
  cap,
  state,
  clockSeconds,
  onSave,
  onRemove,
  onClose,
}: {
  cap: CapType;
  state: GameState;
  clockSeconds: number;
  onSave: (c: { time: number; pointCap: number }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const recorded = state.caps[cap];
  const [time, setTime] = useState(() =>
    Math.min(MAX_CAP_TIME, Math.max(0, Math.round(recorded?.time ?? clockSeconds))),
  );
  const [pointCap, setPointCap] = useState(() => suggestedPointCap(state, cap));
  const min = minPointCap(state, cap);
  const score = currentScore(state);
  const moveTime = (d: number) => setTime((v) => Math.min(MAX_CAP_TIME, Math.max(0, v + d)));
  const movePoints = (d: number) =>
    setPointCap((v) => Math.min(MAX_POINT_CAP, Math.max(min, v + d)));
  const title = cap === 'half_cap' ? t('term.halftimeCap') : t('term.timeCap');

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.ink }]}
        >
          <Txt variant="heading" accessibilityRole="header">
            {title}
          </Txt>
          <Txt muted>
            {t('term.currentScore')}: {score.home} – {score.away}
          </Txt>
          <Stepper
            label={t('game.capCalledAt', { cap: title })}
            value={mmss(time)}
            steps={[
              { label: '−1:00', delta: -60, disabled: time === 0 },
              { label: '−0:05', delta: -5, disabled: time === 0 },
              { label: '+0:05', delta: 5, disabled: time === MAX_CAP_TIME },
              { label: '+1:00', delta: 60, disabled: time === MAX_CAP_TIME },
            ]}
            onChange={moveTime}
          />
          <Stepper
            label={t('term.newPointCap')}
            value={String(pointCap)}
            steps={[
              { label: '−1', delta: -1, disabled: pointCap <= min },
              { label: '+1', delta: 1, disabled: pointCap >= MAX_POINT_CAP },
            ]}
            onChange={movePoints}
          />
          <Button label={t('common.save')} onPress={() => onSave({ time, pointCap })} />
          {recorded && <Button label={t('term.removeCap')} kind="secondary" onPress={onRemove} />}
          <Button label={t('common.cancel')} kind="secondary" onPress={onClose} />
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
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
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

/**
 * Rosters: tap a player to toggle, with the jersey number first and C / SC badges.
 * Like the server's web form, a team with no saved roster shows every pickable player as
 * selected. Nothing is queued until the user saves that default or changes it, so a game
 * kept as a result only (no rosters) stays that way.
 */
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
  const isBlocked = (p: { accredited?: boolean }) =>
    state.rules.require_accreditation && p.accredited === false;
  const pickable = state.eligible[side].filter((p) => !isBlocked(p));
  const saved = state.rosters[side];
  const draft = saved.length === 0 && pickable.length > 0;
  const current: RosterEntry[] = draft
    ? pickable.map((p) => ({
        player_id: p.player_id,
        number: p.number,
        captain: false,
        spirit_captain: false,
      }))
    : saved;
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
      {state.eligible[side].length === 0 ? (
        <Txt muted>{t('game.noPlayers')}</Txt>
      ) : (
        <Txt muted>
          {draft
            ? t('game.rosterDefault', { count: current.length })
            : t('game.rosterCount', { count: saved.length, total: pickable.length })}
        </Txt>
      )}
      {draft && <Button label={t('game.rosterSave')} onPress={() => onSave(current)} />}
      {state.eligible[side].map((p) => {
        const entry = on(p.player_id);
        const blocked = isBlocked(p);
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
    padding: SPACE.sm,
    gap: SPACE.xs,
  },
  steps: { flexDirection: 'row', gap: SPACE.sm, alignSelf: 'stretch' },
  step: {
    flex: 1,
    height: TARGET.live,
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
  stepper: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  chip: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamButton: {
    flex: 1,
    height: TARGET.live * 1.5,
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

/**
 * The game's scorekeeper name, saved when editing ends. Remount it with `key={value}` so a
 * change from elsewhere (the server version kept after a conflict) replaces the draft.
 */
export function ScorekeeperField({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled?: boolean;
  onSave: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? '');
  const save = () => {
    const name = cleanOfficial(draft);
    setDraft(name);
    if (name !== (value ?? '')) onSave(name || null);
  };
  return (
    <View style={{ gap: 4 }}>
      <Txt muted>{t('term.scorekeeper')}</Txt>
      <TextField
        value={draft}
        onChangeText={setDraft}
        onEndEditing={save}
        editable={!disabled}
        maxLength={MAX_OFFICIAL_LENGTH}
        placeholder={t('game.scorekeeperPlaceholder')}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel={t('term.scorekeeper')}
      />
    </View>
  );
}

/**
 * The game note, as on the Scorekeeper note page: saved with the button, an empty text
 * clears it. The server takes at most 4000 UTF-8 bytes; the count shows near the limit.
 */
export function NoteField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (text: string) => boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? '');
  const bytes = utf8Bytes(draft.trim());
  const changed = draft.trim() !== (value ?? '');
  return (
    <View style={{ gap: 4 }}>
      <Txt muted>{t('game.note')}</Txt>
      <TextField
        value={draft}
        onChangeText={setDraft}
        multiline
        textAlignVertical="top"
        style={{ minHeight: TARGET.min * 2, paddingVertical: SPACE.sm }}
        accessibilityLabel={t('game.note')}
      />
      {bytes > MAX_NOTE_BYTES * 0.9 && (
        <Txt variant="small" muted>
          {t('game.noteBytes', { bytes, max: MAX_NOTE_BYTES })}
        </Txt>
      )}
      <Button
        label={t('common.save')}
        kind="secondary"
        disabled={!changed || bytes > MAX_NOTE_BYTES}
        onPress={() => {
          if (onSave(draft)) setDraft(draft.trim());
        }}
      />
    </View>
  );
}
