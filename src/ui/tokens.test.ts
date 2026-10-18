import { DAY, NIGHT, TEAM_SWATCHES, contrastRatio, defaultTeamColors, readableOn } from './tokens';

describe('contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
  it.each([
    ['day', DAY],
    ['night', NIGHT],
  ])('%s: ink is at least 15:1 and muted at least 7:1 on the surface', (_n, p) => {
    expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(15);
    expect(contrastRatio(p.muted, p.surface)).toBeGreaterThanOrEqual(7);
  });
  it('uses true white and true black surfaces', () => {
    expect(DAY.surface).toBe('#FFFFFF');
    expect(NIGHT.surface).toBe('#000000');
  });
  it('text on a signal-colour fill reads at 4.5:1 or better', () => {
    // The bar is a fill with its signal text on it, never a thin graphic on the surface:
    // day warn (#E8A200) is only 2.2:1 against white, so it must not be used as a line or icon.
    for (const p of [DAY, NIGHT]) {
      for (const c of [p.signalGo, p.signalWarn, p.signalStop]) {
        expect(contrastRatio(c, readableOn(c))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('every team swatch gets text at 7:1 or better', () => {
    expect(TEAM_SWATCHES).toHaveLength(12);
    for (const swatch of TEAM_SWATCHES) {
      expect(contrastRatio(swatch, readableOn(swatch))).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('defaultTeamColors', () => {
  it('gives two different colours, stable per game', () => {
    for (let id = 0; id < 200; id++) {
      const c = defaultTeamColors(id);
      expect(c.home).not.toBe(c.away);
      expect(defaultTeamColors(id)).toEqual(c);
    }
  });
});
