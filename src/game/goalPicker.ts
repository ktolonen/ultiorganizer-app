/**
 * The goal sheet flow: tap the assist, then the scorer, and the goal saves on the
 * second tap. "Callahan" skips the assist; "Unknown" stands for a null player.
 */
export type PickerState = {
  callahan: boolean;
  /** `undefined` until chosen; `null` means unknown. */
  assist: number | null | undefined;
};

export const initialPicker: PickerState = { callahan: false, assist: undefined };

export type PickOutcome =
  | { done: false; state: PickerState }
  | { done: true; goal: { scorerId: number | null; assistId: number | null; callahan: boolean } };

export type Step = 'assist' | 'scorer';

export const stepOf = (s: PickerState): Step =>
  s.callahan || s.assist !== undefined ? 'scorer' : 'assist';

export function toggleCallahan(s: PickerState): PickerState {
  // Switching to Callahan drops a chosen assist: a Callahan goal has none.
  return s.callahan
    ? { callahan: false, assist: undefined }
    : { callahan: true, assist: undefined };
}

/** A tap on a player, or on "Unknown" (`null`). */
export function pick(s: PickerState, playerId: number | null): PickOutcome {
  if (stepOf(s) === 'assist') {
    return { done: false, state: { ...s, assist: playerId } };
  }
  const assistId = s.callahan ? null : (s.assist ?? null);
  // The scorer cannot also be the assist; ignore that tap.
  if (playerId !== null && playerId === assistId) return { done: false, state: s };
  return { done: true, goal: { scorerId: playerId, assistId, callahan: s.callahan } };
}

/** Back one step (a wrong assist tap). */
export function back(s: PickerState): PickerState {
  return { ...s, assist: undefined };
}
