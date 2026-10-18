export type ActionKey =
  | 'betweenpoints'
  | 'timeout'
  | 'timeoutbeforepull'
  | 'halftime'
  | 'halfstart'
  | 'dispute'
  | 'discretrieval';

/** The actions that start a timer. `timeoutbeforepull` only holds a template signal. */
export type ActionId = Exclude<ActionKey, 'timeoutbeforepull'>;

export const ACTION_IDS: readonly ActionId[] = [
  'betweenpoints',
  'timeout',
  'halfstart',
  'halftime',
  'dispute',
  'discretrieval',
];

export type TemplateSignal = { id: number; time: number; text: string };
export type SignalsByAction = Record<ActionKey, TemplateSignal[]>;
export type Caps = { half_time_cap: number; time_cap: number };

export type TimekeeperTemplate = {
  id: number;
  name: string;
  caps: Caps;
  signals: SignalsByAction;
};

export type TemplateSet = { defaultTemplateId: number; templates: TimekeeperTemplate[] };

let nextId = 1;
const s = (time: number, text: string): TemplateSignal => ({ id: nextId++, time, text });

/**
 * WFDF defaults, the same rows `sql/upgrade_db.php` seeds in the server. Used when
 * the server has no templates route (404) or is unreachable and nothing is cached.
 * Texts are English here; the UI translates them by `text`.
 */
export const WFDF_TEMPLATE: TimekeeperTemplate = {
  id: 0,
  name: 'WFDF',
  caps: { half_time_cap: 55, time_cap: 100 },
  signals: {
    betweenpoints: [s(45, 'Offence warning'), s(60, 'Defence warning'), s(75, 'Play')],
    timeout: [
      s(45, 'Offence warning'),
      s(60, 'Offence warning'),
      s(75, 'Defence warning'),
      s(90, 'Play'),
    ],
    timeoutbeforepull: [s(75, 'Timeout over')],
    halftime: [s(390, 'Halftime ending'), s(420, 'Halftime over')],
    halfstart: [s(0, 'Approaching start'), s(60, 'Start of play')],
    dispute: [s(45, 'Resolve call or discussion'), s(60, 'Play must restart')],
    discretrieval: [s(20, 'Play')],
  },
};

export const BUNDLED_TEMPLATES: TemplateSet = {
  defaultTemplateId: WFDF_TEMPLATE.id,
  templates: [WFDF_TEMPLATE],
};

export const EMPTY_SIGNALS: SignalsByAction = {
  betweenpoints: [],
  timeout: [],
  timeoutbeforepull: [],
  halftime: [],
  halfstart: [],
  dispute: [],
  discretrieval: [],
};

/** Local, per-device edits to a template: signal times by signal id and cap minutes. */
export type TemplateOverrides = { signals?: Record<string, number>; caps?: Partial<Caps> };

const nonNegative = (n: unknown): number => {
  const v = typeof n === 'number' ? Math.floor(n) : parseInt(String(n), 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** Applies local overrides and sorts each action's rows by time, then id. */
export function resolveTemplate(
  template: TimekeeperTemplate,
  overrides: TemplateOverrides = {},
): { signals: SignalsByAction; caps: Caps } {
  const signals = { ...EMPTY_SIGNALS };
  for (const key of Object.keys(EMPTY_SIGNALS) as ActionKey[]) {
    signals[key] = (template.signals[key] ?? [])
      .map((row) => ({
        ...row,
        time:
          overrides.signals && String(row.id) in overrides.signals
            ? nonNegative(overrides.signals[String(row.id)])
            : nonNegative(row.time),
      }))
      .sort((a, b) => a.time - b.time || a.id - b.id);
  }
  const caps: Caps = {
    half_time_cap: nonNegative(overrides.caps?.half_time_cap ?? template.caps.half_time_cap),
    time_cap: nonNegative(overrides.caps?.time_cap ?? template.caps.time_cap),
  };
  return { signals, caps };
}
