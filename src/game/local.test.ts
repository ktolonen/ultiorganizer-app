import { fromEntryContext, type GameEvent } from './reducer';
import { applyEvent, type GameSession } from './runtime';
import {
  LOCAL_SERVER_ID,
  localEntryContext,
  localPlayerId,
  localTimestamp,
  newLocalSession,
} from './local';
import { assistLabel, playerLabel } from './players';
import { entryContextSchema } from './types';

const input = { home: '  Lions ', away: '', field: 'Field 9', timeoutsPerTeam: 3 };
const NOW = new Date(2026, 5, 1, 10, 7, 30).getTime();
const deps = { now: NOW, newKey: () => 'k' };

function run(s: GameSession, events: readonly GameEvent[]): GameSession {
  for (const ev of events) {
    const r = applyEvent(s, ev, deps);
    if (!r.ok) throw new Error(r.error.code);
    s = r.session;
  }
  return s;
}

const goal = (scorer: number | null, assist: number | null, callahan = false): GameEvent => ({
  type: 'goal',
  side: 'home',
  scorerId: scorer === null ? null : localPlayerId(scorer),
  assistId: assist === null ? null : localPlayerId(assist),
  callahan,
  time: 60,
});

describe('local games', () => {
  it('builds an entry context the stored-data schema accepts', () => {
    const ctx = localEntryContext(4, input, NOW);
    expect(entryContextSchema.safeParse(ctx).success).toBe(true);
    expect(ctx.game).toMatchObject({ game_id: 4, field: 'Field 9', time: '2026-06-01 10:07:00' });
    expect(ctx.home).toMatchObject({ team_id: null, name: 'Lions' });
    expect(ctx.away.name).toBeNull();
    expect(ctx.rules.timeouts_per_team).toBe(3);
  });
  it('clamps the timeouts and the team names', () => {
    const ctx = localEntryContext(1, { ...input, home: 'x'.repeat(80), timeoutsPerTeam: 40 }, NOW);
    expect(ctx.home.name).toHaveLength(50);
    expect(ctx.rules.timeouts_per_team).toBe(9);
  });
  it('gives each team a roster of jersey numbers 0-99', () => {
    const ctx = localEntryContext(1, input, NOW);
    for (const side of [ctx.home, ctx.away]) {
      expect(side.roster).toHaveLength(100);
      expect(side.eligible_players).toHaveLength(100);
      expect(side.roster[7]).toEqual({
        player_id: localPlayerId(7),
        number: 7,
        captain: false,
        spirit_captain: false,
      });
      expect(side.eligible_players[0]).toEqual({ player_id: 1, name: '', number: 0 });
    }
  });
  it('records goals by jersey number, with Callahans, unknowns and corrections', () => {
    const s = run(newLocalSession(1, 'Lions – Away', input, NOW), [
      goal(7, 12),
      goal(0, null, true),
      goal(null, null),
      {
        type: 'correct_goal',
        num: 1,
        scorerId: localPlayerId(8),
        assistId: localPlayerId(12),
        callahan: false,
      },
    ]);
    const lines = s.state.goals.map((g) => [
      playerLabel(s.state, g.side, g.scorerId),
      g.callahan ? 'C' : assistLabel(s.state, g.side, g.assistId),
    ]);
    expect(lines).toEqual([
      ['8', '12'],
      ['0', 'C'],
      ['?', '?'],
    ]);
    expect(s.state.result).toEqual({ home: 3, away: 0, state: 'ongoing' });
    expect(s.outbox.rows).toEqual([]);
  });
  it('refuses the same number as scorer and assist, like a server game', () => {
    const r = applyEvent(newLocalSession(1, '', input, NOW), goal(7, 7), deps);
    expect(r.ok).toBe(false);
  });
  it('keeps score, timeouts and caps without queueing anything', () => {
    const s = run(newLocalSession(1, 'Lions – Away', input, NOW), [
      goal(7, 12),
      { type: 'timeout', side: 'away', time: 300 },
      { type: 'cap', cap: 'time_cap', time: 4800, pointCap: 5 },
      { type: 'finalize' },
    ]);
    expect(s.serverId).toBe(LOCAL_SERVER_ID);
    expect(s.state.result).toEqual({ home: 1, away: 0, state: 'final' });
    expect(s.state.caps.time_cap?.pointCap).toBe(5);
    expect(s.outbox.rows).toEqual([]);
  });
  it('still counts score taps in a local game saved before the numbers existed', () => {
    const fresh = newLocalSession(1, '', input, NOW);
    const empty = { team_id: null, eligible_players: [], roster: [] };
    const context = {
      ...fresh.context,
      home: { ...fresh.context.home, ...empty },
      away: { ...fresh.context.away, ...empty },
    };
    expect(entryContextSchema.safeParse(context).success).toBe(true);
    const s = run({ ...fresh, context, state: fromEntryContext(context) }, [
      { type: 'score_tap', side: 'home', delta: 1 },
      { type: 'score_tap', side: 'away', delta: 1 },
    ]);
    expect(s.state.result).toEqual({ home: 1, away: 1, state: 'ongoing' });
  });
  it('formats device time like the server', () => {
    expect(localTimestamp(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04:00');
  });
});
