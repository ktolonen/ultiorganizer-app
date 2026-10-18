import { back, initialPicker, pick, stepOf, toggleCallahan, type PickerState } from './goalPicker';

describe('goal picker', () => {
  it('saves on the second tap: assist, then scorer', () => {
    const first = pick(initialPicker, 2);
    expect(first).toEqual({ done: false, state: { callahan: false, assist: 2 } });
    expect(stepOf((first as { state: PickerState }).state)).toBe('scorer');
    expect(pick((first as { state: PickerState }).state, 1)).toEqual({
      done: true,
      goal: { scorerId: 1, assistId: 2, callahan: false },
    });
  });
  it('ignores the assist tapped again as the scorer', () => {
    const s: PickerState = { callahan: false, assist: 2 };
    expect(pick(s, 2)).toEqual({ done: false, state: s });
  });
  it('accepts an unknown assist and an unknown scorer', () => {
    const afterAssist = pick(initialPicker, null);
    expect(afterAssist).toEqual({ done: false, state: { callahan: false, assist: null } });
    expect(pick({ callahan: false, assist: null }, null)).toEqual({
      done: true,
      goal: { scorerId: null, assistId: null, callahan: false },
    });
  });
  it('a Callahan needs only the scorer and has no assist', () => {
    const s = toggleCallahan(initialPicker);
    expect(stepOf(s)).toBe('scorer');
    expect(pick(s, 3)).toEqual({
      done: true,
      goal: { scorerId: 3, assistId: null, callahan: true },
    });
  });
  it('switching to Callahan after picking an assist drops the assist', () => {
    expect(toggleCallahan({ callahan: false, assist: 2 })).toEqual({
      callahan: true,
      assist: undefined,
    });
    expect(toggleCallahan({ callahan: true, assist: undefined })).toEqual(initialPicker);
  });
  it('goes back one step', () => {
    expect(back({ callahan: false, assist: 2 })).toEqual(initialPicker);
  });
});
