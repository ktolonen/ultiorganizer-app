/** Design tokens from PLAN.md "Visual design". Neutral UI; colour comes from the teams. */

export type Palette = {
  surface: string;
  ink: string;
  line: string;
  signalGo: string;
  signalWarn: string;
  signalStop: string;
  /** Secondary text, still 7:1 on the surface. */
  muted: string;
};

export const LIGHT: Palette = {
  surface: '#FFFFFF',
  ink: '#0A1620',
  line: '#C9D2D9',
  signalGo: '#0F8A4B',
  signalWarn: '#E8A200',
  signalStop: '#D21F3C',
  muted: '#3C4A56',
};

export const DARK: Palette = {
  surface: '#000000',
  ink: '#F2F5F7',
  line: '#2A3640',
  signalGo: '#3DDC84',
  signalWarn: '#FFC93C',
  signalStop: '#FF5A6E',
  muted: '#B4C0C9',
};

export const FONTS = {
  figures: 'BarlowCondensed_700Bold',
  figuresSemi: 'BarlowCondensed_600SemiBold',
  text: 'AtkinsonHyperlegibleNext_400Regular',
  textBold: 'AtkinsonHyperlegibleNext_700Bold',
} as const;

/** Type scale (pt). */
export const SIZE = { xs: 13, sm: 16, md: 20, lg: 28, xl: 44, score: 96, hero: 160 } as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Touch targets: 48 pt everywhere, 64 pt on the live screen. */
export const TARGET = { min: 48, live: 64 } as const;

/** Twelve jersey-like swatches. Light and dark are allowed; text colour flips to keep 7:1. */
export const TEAM_SWATCHES = [
  '#0B2A5B', // navy
  '#A8142B', // red
  '#0B5D2E', // forest
  '#5B2A86', // purple
  '#6B1020', // maroon
  '#1F2933', // charcoal
  '#FFFFFF', // white
  '#FFD60A', // yellow
  '#FFA24A', // orange
  '#8AE08A', // light green
  '#8CCBFF', // sky
  '#FFB3C7', // pink
] as const;

/* ------------------------------------------------------------------ */
/* Contrast                                                            */
/* ------------------------------------------------------------------ */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the colour. */
export function readableOn(background: string): '#000000' | '#FFFFFF' {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#000000')
    ? '#FFFFFF'
    : '#000000';
}

/** Picks two different swatches for a game, stable for the same ids. */
export function defaultTeamColors(gameId: number): { home: string; away: string } {
  const n = TEAM_SWATCHES.length;
  const home = Math.abs(gameId) % n;
  const away = (home + 1 + (Math.abs(gameId) % (n - 1))) % n;
  return { home: TEAM_SWATCHES[home], away: TEAM_SWATCHES[away === home ? (home + 1) % n : away] };
}
