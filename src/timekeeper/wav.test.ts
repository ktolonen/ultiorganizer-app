import { GO_TONES, SAMPLE_RATE, WARN_TONES, makeWav } from './wav';

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

describe('makeWav', () => {
  it('writes a valid mono 16-bit PCM header', () => {
    const wav = makeWav(WARN_TONES);
    const v = new DataView(wav.buffer);
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(text(wav, 36, 4)).toBe('data');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(v.getUint32(40, true)).toBe(wav.length - 44);
  });
  it('is long enough for its tones, and the final signal is longer than a warning', () => {
    expect(makeWav(GO_TONES).length).toBeGreaterThan(makeWav(WARN_TONES).length);
    const ms = ((makeWav(GO_TONES).length - 44) / 2 / SAMPLE_RATE) * 1000;
    expect(ms).toBeGreaterThanOrEqual(340);
  });
  it('is silent in the gap between the two beeps and loud inside them', () => {
    const wav = makeWav(GO_TONES);
    const v = new DataView(wav.buffer);
    const at = (ms: number) =>
      Math.abs(v.getInt16(44 + Math.floor((ms / 1000) * SAMPLE_RATE) * 2, true));
    expect(at(170)).toBe(0); // between 140 ms and 200 ms
    const peak = Math.max(...Array.from({ length: 40 }, (_, i) => at(60 + i)));
    expect(peak).toBeGreaterThan(5000);
  });
});
