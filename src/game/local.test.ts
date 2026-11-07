import { applyEvent } from './runtime';
import { LOCAL_SERVER_ID, localEntryContext, localTimestamp, newLocalSession } from './local';
import { entryContextSchema } from './types';

const input = { home: '  Lions ', away: '', field: 'Field 9', timeoutsPerTeam: 3 };
const NOW = new Date(2026, 5, 1, 10, 7, 30).getTime();

describe('local games', () => {
  it('builds an entry context the stored-data schema accepts', () => {
    const ctx = localEntryContext(4, input, NOW);
    expect(entryContextSchema.safeParse(ctx).success).toBe(true);
    expect(ctx.game).toMatchObject({ game_id: 4, field: 'Field 9', time: '2026-06-01 10:07:00' });
    expect(ctx.home).toMatchObject({ team_id: null, name: 'Lions', eligible_players: [] });
    expect(ctx.away.name).toBeNull();
    expect(ctx.rules.timeouts_per_team).toBe(3);
  });
  it('clamps the timeouts and the team names', () => {
    const ctx = localEntryContext(1, { ...input, home: 'x'.repeat(80), timeoutsPerTeam: 40 }, NOW);
    expect(ctx.home.name).toHaveLength(50);
    expect(ctx.rules.timeouts_per_team).toBe(9);
  });
  it('keeps score, timeouts and caps without queueing anything', () => {
    let s = newLocalSession(1, 'Lions – Away', input, NOW);
    expect(s.serverId).toBe(LOCAL_SERVER_ID);
    const deps = { now: NOW, newKey: () => 'k' };
    for (const ev of [
      { type: 'score_tap', side: 'home', delta: 1 },
      { type: 'timeout', side: 'away', time: 300 },
      { type: 'cap', cap: 'time_cap', time: 4800, pointCap: 5 },
      { type: 'finalize' },
    ] as const) {
      const r = applyEvent(s, ev, deps);
      if (!r.ok) throw new Error(r.error.code);
      s = r.session;
    }
    expect(s.state.result).toEqual({ home: 1, away: 0, state: 'final' });
    expect(s.state.caps.time_cap?.pointCap).toBe(5);
    expect(s.outbox.rows).toEqual([]);
  });
  it('formats device time like the server', () => {
    expect(localTimestamp(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04:00');
  });
});
