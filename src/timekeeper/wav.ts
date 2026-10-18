/**
 * Generated beeps (no audio asset files, like the web Timekeeper): a mono 16-bit
 * PCM WAV built from square-wave tones. Warning: one 880 Hz beep. Final signal:
 * two 1320 Hz beeps.
 */

export type Tone = { frequency: number; durationMs: number; startMs: number };

export const WARN_TONES: Tone[] = [{ frequency: 880, durationMs: 160, startMs: 0 }];
export const GO_TONES: Tone[] = [
  { frequency: 1320, durationMs: 140, startMs: 0 },
  { frequency: 1320, durationMs: 140, startMs: 200 },
];

export const SAMPLE_RATE = 22050;

export function makeWav(tones: readonly Tone[], sampleRate = SAMPLE_RATE): Uint8Array {
  const totalMs = Math.max(...tones.map((t) => t.startMs + t.durationMs)) + 60;
  const samples = Math.ceil((totalMs / 1000) * sampleRate);
  const pcm = new Int16Array(samples);
  for (const tone of tones) {
    const start = Math.floor((tone.startMs / 1000) * sampleRate);
    const length = Math.floor((tone.durationMs / 1000) * sampleRate);
    const period = sampleRate / tone.frequency;
    const fade = Math.floor(sampleRate * 0.01); // 10 ms ramps avoid clicks
    for (let i = 0; i < length && start + i < samples; i++) {
      const square = i % period < period / 2 ? 1 : -1;
      const envelope = Math.min(1, i / fade, (length - i) / fade);
      pcm[start + i] = Math.round(square * envelope * 0.25 * 32767);
    }
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return bytes;
}
