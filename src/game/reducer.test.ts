import { entryContextFixture } from './fixtures';
import {
  type GameEvent,
  type GameState,
  cleanOfficial,
  currentScore,
  fromEntryContext,
  minPointCap,
  reduce,
  replay,
  suggestedPointCap,
  timeoutsLeft,
} from './reducer';
import { entryContextSchema } from './types';
import { toGameData } from './upload';

const base = (over: Parameters<typeof entryContextFixture>[0] = {}) =>
  fromEntryContext(entryContextFixture(over));
const rulesWith = (patch: Partial<ReturnType<typeof entryContextFixture>['rules']>) =>
  base({ rules: { ...entryContextFixture().rules, ...patch } });

const goal = (
  side: 'home' | 'away',
  scorerId: number | null,
  assistId: number | null,
  time: number | null,
  callahan = false,
): GameEvent => ({ type: 'goal', side, scorerId, assistId, callahan, time });

function must(state: GameState, ev: GameEvent): GameState {
  const r = reduce(state, ev);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}
const code = (state: GameState, ev: GameEvent) => {
  const r = reduce(state, ev);
  return r.ok ? 'ok' : `${r.error.code}${r.error.path ? ':' + r.error.path : ''}`;
};

describe('entry context', () => {
  it('parses the fixture with the zod schema', () => {
    expect(entryContextSchema.safeParse(entryContextFixture()).success).toBe(true);
  });
  it('rejects a context missing required fields', () => {
    const { token: _t, ...rest } = entryContextFixture();
    expect(entryContextSchema.safeParse(rest).success).toBe(false);
  });
});

describe('goals', () => {
  it('numbers goals and derives cumulative scores and the result', () => {
    let s = base();
    s = must(s, goal('home', 1, 2, 100));
    s = must(s, goal('away', 11, 12, 200));
    s = must(s, goal('home', 3, 1, 200)); // an equal time is allowed
    expect(s.goals.map((g) => [g.num, g.homeScore, g.awayScore])).toEqual([
      [1, 1, 0],
      [2, 1, 1],
      [3, 2, 1],
    ]);
    expect(s.result).toEqual({ home: 2, away: 1, state: 'ongoing' });
  });

  it('refuses times that go backwards or are missing or out of range', () => {
    const s = must(base(), goal('home', 1, 2, 100));
    expect(code(s, goal('away', 11, 12, 99))).toBe('validation_failed:time');
    expect(code(s, goal('away', 11, 12, null))).toBe('validation_failed:time');
    expect(code(s, goal('away', 11, 12, 32768))).toBe('validation_failed:time');
    expect(code(s, goal('away', 11, 12, -1))).toBe('validation_failed:time');
  });

  it('requires null times when the event hides them', () => {
    const s = rulesWith({ hide_time_on_scoresheet: true });
    expect(code(s, goal('home', 1, 2, 10))).toBe('validation_failed:time');
    const next = must(s, goal('home', 1, 2, null));
    expect(next.goals[0].time).toBeNull();
    expect(toGameData(next)).toMatchObject({ ok: true, doc: { goals: [{ time: null }] } });
  });

  it('refuses a Callahan with an assist but accepts one without', () => {
    const s = base();
    expect(code(s, goal('home', 1, 2, 5, true))).toBe('validation_failed:assist_id');
    expect(must(s, goal('home', 1, null, 5, true)).goals[0]).toMatchObject({
      callahan: true,
      assistId: null,
    });
  });

  it('refuses scorer equal to assist', () => {
    expect(code(base(), goal('home', 1, 1, 5))).toBe('validation_failed:assist_id');
  });

  it('accepts unknown scorer and assist (null)', () => {
    expect(code(base(), goal('home', null, null, 5))).toBe('ok');
  });

  it('refuses players who are not on that side’s roster', () => {
    expect(code(base(), goal('home', 11, 2, 5))).toBe('validation_failed:scorer_id');
    expect(code(base(), goal('home', 1, 4, 5))).toBe('validation_failed:assist_id'); // eligible but not rostered
  });

  it('refuses goals in a final game', () => {
    let s = must(base(), goal('home', 1, 2, 5));
    s = must(s, { type: 'finalize' });
    expect(code(s, goal('home', 1, 2, 6))).toBe('game_final');
  });

  it('does not lower a stored score that is already higher', () => {
    let s = must(base(), { type: 'score_tap', side: 'home', delta: 1 });
    s = must(s, { type: 'score_tap', side: 'home', delta: 1 });
    s = must(s, { type: 'score_tap', side: 'home', delta: 1 });
    s = must(s, goal('away', 11, 12, 5));
    expect(s.result).toEqual({ home: 3, away: 1, state: 'ongoing' });
  });

  it('caps goals per side', () => {
    const s = rulesWith({ max_goals_per_side: 1 });
    const one = must(s, goal('home', 1, 2, 5));
    expect(code(one, goal('home', 1, 2, 6))).toBe('validation_failed:side');
    expect(code(one, goal('away', 11, 12, 6))).toBe('ok');
  });
});

describe('delete last goal', () => {
  it('removes the last goal and lowers the result when it tracked the goals', () => {
    let s = must(base(), goal('home', 1, 2, 5));
    s = must(s, goal('away', 11, 12, 9));
    s = must(s, { type: 'delete_last_goal', num: 2 });
    expect(s.goals).toHaveLength(1);
    expect(s.result).toEqual({ home: 1, away: 0, state: 'ongoing' });
  });
  it('keeps a result that was not tracking the goals', () => {
    let s = must(base(), goal('home', 1, 2, 5));
    s = must(s, { type: 'score_tap', side: 'home', delta: 1 }); // 2-0 stored, 1-0 goals
    s = must(s, { type: 'delete_last_goal', num: 1 });
    expect(s.result).toEqual({ home: 2, away: 0, state: 'ongoing' });
  });
  it('refuses any goal but the last, and a final game', () => {
    let s = must(base(), goal('home', 1, 2, 5));
    s = must(s, goal('home', 1, 2, 6));
    expect(code(s, { type: 'delete_last_goal', num: 1 })).toBe('goal_changed:num');
    expect(code(base(), { type: 'delete_last_goal', num: 1 })).toBe('goal_changed:num');
    expect(code(must(s, { type: 'finalize' }), { type: 'delete_last_goal', num: 2 })).toBe(
      'game_final',
    );
  });
});

describe('timeouts and spirit stoppages', () => {
  it('stops at timeouts_per_team and counts what is left', () => {
    let s = base();
    expect(timeoutsLeft(s, 'home')).toBe(2);
    s = must(s, { type: 'timeout', side: 'home', time: 100 });
    s = must(s, { type: 'timeout', side: 'home', time: 400 });
    expect(timeoutsLeft(s, 'home')).toBe(0);
    expect(timeoutsLeft(s, 'away')).toBe(2);
    expect(code(s, { type: 'timeout', side: 'home', time: 500 })).toBe('timeout_limit:side');
  });
  it('allows four spirit stoppages per team and none when disabled', () => {
    let s = base();
    for (let i = 0; i < 4; i++) s = must(s, { type: 'spirit_stoppage', side: 'away', time: i });
    expect(code(s, { type: 'spirit_stoppage', side: 'away', time: 9 })).toBe(
      'spirit_stoppage_limit:side',
    );
    expect(
      code(rulesWith({ spirit_stoppages_enabled: false }), {
        type: 'spirit_stoppage',
        side: 'home',
        time: 1,
      }),
    ).toBe('spirit_stoppages_disabled');
  });
  it('validates the time', () => {
    expect(code(base(), { type: 'timeout', side: 'home', time: 86401 })).toBe(
      'validation_failed:time',
    );
    expect(code(base(), { type: 'timeout', side: 'home', time: 1.5 })).toBe(
      'validation_failed:time',
    );
  });
  it('removes an older entry locally', () => {
    let s = must(base(), { type: 'timeout', side: 'home', time: 100 });
    s = must(s, { type: 'timeout', side: 'home', time: 200 });
    s = must(s, { type: 'remove_timeout', side: 'home', index: 0 });
    expect(s.timeouts.home).toEqual([{ time: 200 }]);
    expect(code(s, { type: 'remove_timeout', side: 'home', index: 5 })).toBe(
      'validation_failed:index',
    );
  });
});

describe('score taps', () => {
  it('starts and changes the result, and returns to not started at 0-0', () => {
    let s = must(base(), { type: 'score_tap', side: 'away', delta: 1 });
    expect(s.result).toEqual({ home: 0, away: 1, state: 'ongoing' });
    s = must(s, { type: 'score_tap', side: 'away', delta: -1 });
    expect(s.result).toBeNull();
  });
  it('refuses a negative score, the max and a final game', () => {
    expect(code(base(), { type: 'score_tap', side: 'home', delta: -1 })).toBe('score_out_of_range');
    const s = rulesWith({ max_game_score: 1 });
    const one = must(s, { type: 'score_tap', side: 'home', delta: 1 });
    expect(code(one, { type: 'score_tap', side: 'home', delta: 1 })).toBe('score_out_of_range');
    expect(
      code(must(one, { type: 'finalize' }), { type: 'score_tap', side: 'home', delta: -1 }),
    ).toBe('game_final');
  });
});

describe('rosters', () => {
  const rp = (id: number, number: number | null) => ({
    player_id: id,
    number,
    captain: false,
    spirit_captain: false,
  });
  it('replaces one side', () => {
    const s = must(base(), { type: 'roster', side: 'home', players: [rp(1, 7), rp(4, null)] });
    expect(s.rosters.home.map((p) => p.player_id)).toEqual([1, 4]);
    expect(s.rosters.away).toHaveLength(3);
  });
  it('refuses duplicates, strangers and bad numbers', () => {
    const ev = (players: ReturnType<typeof rp>[]): GameEvent => ({
      type: 'roster',
      side: 'home',
      players,
    });
    expect(code(base(), ev([rp(1, 1), rp(1, 2)]))).toBe('validation_failed:players[1]');
    expect(code(base(), ev([rp(11, 1)]))).toBe('validation_failed:players[0]');
    expect(code(base(), ev([rp(1, 256)]))).toBe('validation_failed:players[0].number');
  });
  it('refuses unaccredited players when the event requires accreditation', () => {
    const ctx = entryContextFixture();
    ctx.rules.require_accreditation = true;
    ctx.home.eligible_players[3] = { ...ctx.home.eligible_players[3], accredited: false };
    ctx.home.eligible_players[0] = { ...ctx.home.eligible_players[0], accredited: true };
    const s = fromEntryContext(ctx);
    expect(code(s, { type: 'roster', side: 'home', players: [rp(4, 4)] })).toBe(
      'validation_failed:players[0]',
    );
    expect(code(s, { type: 'roster', side: 'home', players: [rp(1, 1)] })).toBe('ok');
  });
  it('keeps players that a goal or the defence sheet refers to', () => {
    const s = must(base(), goal('home', 1, 2, 5));
    expect(code(s, { type: 'roster', side: 'home', players: [rp(3, 3)] })).toBe(
      'player_referenced:players',
    );
    const d = base({
      retained: {
        ...entryContextFixture().retained,
        defenses: { home: 1, away: 0, referenced_player_ids: [3] },
      },
    });
    expect(code(d, { type: 'roster', side: 'home', players: [rp(1, 1)] })).toBe(
      'player_referenced:players',
    );
    expect(code(d, { type: 'roster', side: 'away', players: [rp(11, 1)] })).toBe('ok');
  });
});

describe('metadata and finalize', () => {
  it('changes only the fields sent, and treats 0 and empty as unset', () => {
    let s = must(base(), {
      type: 'metadata',
      startingOffence: 'away',
      halftime: 1500,
      official: 'Kari',
    });
    s = must(s, { type: 'metadata', official: '' });
    expect(s).toMatchObject({ startingOffence: 'away', halftime: 1500, official: null });
    s = must(s, { type: 'metadata', halftime: 0 });
    expect(s.halftime).toBeNull();
    s = must(s, { type: 'metadata', startingOffence: null });
    expect(s.startingOffence).toBeNull();
  });
  it('validates bounds', () => {
    expect(code(base(), { type: 'metadata', halftime: 86401 })).toBe('validation_failed:halftime');
    expect(code(base(), { type: 'metadata', official: 'x'.repeat(51) })).toBe(
      'validation_failed:official',
    );
  });
  it('trims a typed scorekeeper name and caps it at the accepted length', () => {
    expect(cleanOfficial('  Kari  ')).toBe('Kari');
    expect(cleanOfficial('   ')).toBe('');
    expect(cleanOfficial('x'.repeat(60))).toHaveLength(50);
    expect(code(base(), { type: 'metadata', official: cleanOfficial('x'.repeat(60)) })).toBe('ok');
  });
  it('finalizes only a game with a score, once', () => {
    expect(code(base(), { type: 'finalize' })).toBe('validation_failed');
    const s = must(must(base(), goal('home', 1, 2, 5)), { type: 'finalize' });
    expect(s.result?.state).toBe('final');
    expect(code(s, { type: 'finalize' })).toBe('game_final');
  });
});

describe('forfeit', () => {
  it('refuses every event', () => {
    const s = base({ retained: { ...entryContextFixture().retained, forfeit: 'home' } });
    expect(code(s, goal('home', 1, 2, 5))).toBe('forfeit');
    expect(code(s, { type: 'finalize' })).toBe('forfeit');
  });
});

describe('replay and score display', () => {
  it('stops at the first refused event', () => {
    const r = replay(base(), [
      goal('home', 1, 2, 50),
      goal('home', 1, 2, 10),
      goal('home', 1, 2, 60),
    ]);
    expect(r.failedAt).toBe(1);
    expect(r.state.goals).toHaveLength(1);
  });
  it('shows the stored result, else the goal total', () => {
    expect(currentScore(base())).toEqual({ home: 0, away: 0 });
    expect(currentScore(must(base(), goal('away', 11, 12, 5)))).toEqual({ home: 0, away: 1 });
  });
});

describe('toGameData (full upload)', () => {
  it('builds the document the API expects', () => {
    let s = must(base(), { type: 'metadata', startingOffence: 'home' });
    s = must(s, goal('home', 1, null, 180, true));
    const r = toGameData(s);
    expect(r).toMatchObject({
      ok: true,
      doc: {
        version: 1,
        home_team_id: 90300,
        away_team_id: 90301,
        goals: [{ side: 'home', scorer_id: 1, assist_id: null, callahan: true, time: 180 }],
        result: { home: 1, away: 0, state: 'ongoing' },
        starting_offence: 'home',
      },
    });
  });
  it('refuses goals without a result and a result that disagrees with the goals', () => {
    const s = must(base(), goal('home', 1, 2, 5));
    expect(toGameData({ ...s, result: null })).toMatchObject({
      ok: false,
      error: { path: 'result' },
    });
    expect(toGameData({ ...s, result: { home: 3, away: 0, state: 'ongoing' } })).toMatchObject({
      ok: false,
    });
  });
  it('allows a result-only game (taps, no goals)', () => {
    const s = must(base(), { type: 'score_tap', side: 'home', delta: 1 });
    expect(toGameData(s)).toMatchObject({
      ok: true,
      doc: { goals: [], result: { home: 1, away: 0 } },
    });
  });
  it('refuses a fixture without teams', () => {
    const s = base();
    expect(toGameData({ ...s, teamIds: { home: null, away: 5 } }).ok).toBe(false);
  });
});

describe('caps', () => {
  const cap = (pointCap: number, time = 1500, which: 'half_cap' | 'time_cap' = 'half_cap') =>
    ({ type: 'cap', cap: which, time, pointCap }) as const;
  const at = (home: number, away: number) => base({ result: { home, away, state: 'ongoing' } });

  it('reads recorded caps from the entry context and ignores unknown types', () => {
    const s = base({
      retained: {
        ...entryContextFixture().retained,
        cap_events: [
          { type: 'time_cap', time: 4800, point_cap: 12 },
          { type: 'soft_cap', time: 1, point_cap: 1 },
        ],
      },
    });
    expect(s.caps).toEqual({ time_cap: { time: 4800, pointCap: 12 } });
  });
  it('records a new cap above the higher score', () => {
    const s = must(at(7, 5), cap(8));
    expect(s.caps.half_cap).toEqual({ time: 1500, pointCap: 8 });
    expect(code(at(7, 5), cap(7))).toBe('point_cap_too_low:point_cap');
  });
  it('lets a recorded cap be corrected to any point cap from 1', () => {
    const s = must(must(at(7, 5), cap(8)), cap(3, 1600));
    expect(s.caps.half_cap).toEqual({ time: 1600, pointCap: 3 });
    expect(code(s, cap(0))).toBe('validation_failed:point_cap');
    expect(code(s, cap(256))).toBe('validation_failed:point_cap');
  });
  it('checks the time like the server', () => {
    expect(code(base(), cap(1, -1))).toBe('validation_failed:time');
    expect(code(base(), cap(1, 32768))).toBe('validation_failed:time');
    expect(code(base(), cap(1, 32767))).toBe('ok');
  });
  it('allows a cap on a final game and refuses it on a forfeit', () => {
    expect(code(base({ result: { home: 9, away: 4, state: 'final' } }), cap(10))).toBe('ok');
    const forfeit = base({ retained: { ...entryContextFixture().retained, forfeit: 'home' } });
    expect(code(forfeit, cap(1))).toBe('forfeit');
  });
  it('is refused while the event hides times', () => {
    expect(code(rulesWith({ hide_time_on_scoresheet: true }), cap(1))).toBe('times_hidden');
  });
  it('removes a cap, and removing an absent one changes nothing', () => {
    const s = must(must(base(), cap(5)), { type: 'remove_cap', cap: 'half_cap' });
    expect(s.caps).toEqual({});
    const same = base();
    expect(must(same, { type: 'remove_cap', cap: 'time_cap' })).toBe(same);
  });
  it('suggests one above the higher score, or the recorded point cap', () => {
    const s = at(7, 9);
    expect(suggestedPointCap(s, 'time_cap')).toBe(10);
    expect(minPointCap(s, 'time_cap')).toBe(10);
    const recorded = must(s, cap(11, 4000, 'time_cap'));
    expect(suggestedPointCap(recorded, 'time_cap')).toBe(11);
    expect(minPointCap(recorded, 'time_cap')).toBe(1);
  });
  it('is left out of a full upload', () => {
    const s = must(base(), cap(5));
    expect(JSON.stringify(toGameData(s))).not.toMatch(/point_cap|_cap"/);
  });
});
