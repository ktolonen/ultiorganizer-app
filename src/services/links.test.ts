import { DatabaseSync } from 'node:sqlite';
import type { Discovery, DiscoveredGame } from '../api/http';
import { type Db, migrate } from '../store/migrations';
import { createRepo } from '../store/repo';
import {
  dayOf,
  formatClock,
  formatDay,
  formatDayTime,
  linkSummary,
  rememberLink,
  shouldRemember,
} from './links';

const game = (id: number, time: string | null, field: string | null): DiscoveredGame => ({
  game_id: id,
  time,
  field,
  location: null,
  pool: { pool_id: null, name: null },
  home: { team_id: 1, name: 'A' },
  away: { team_id: 2, name: 'B' },
  result: { state: 'not_started', home: null, away: null },
});
const list = (games: DiscoveredGame[], available_from: string | null = null): Discovery => ({
  games,
  available_from,
});

describe('shouldRemember', () => {
  it('keeps field links and not-yet-open links, not single-game links', () => {
    expect(shouldRemember(list([game(1, null, 'F1'), game(2, null, 'F1')]))).toBe(true);
    expect(shouldRemember(list([game(1, null, 'F1')]))).toBe(false);
    expect(shouldRemember(list([], '2026-11-01'))).toBe(true);
    expect(shouldRemember(list([]))).toBe(false);
  });
});

describe('linkSummary', () => {
  it('names the distinct fields and the earliest day', () => {
    expect(
      linkSummary(
        list([
          game(1, '2026-11-02 09:00:00', 'Field 3'),
          game(2, '2026-11-01 15:00:00', 'Field 3'),
          game(3, null, 'Field 4'),
          game(4, null, null),
        ]),
      ),
    ).toEqual({ label: 'Field 3, Field 4', day: '2026-11-01' });
  });
  it('falls back to the opening day', () => {
    expect(linkSummary(list([], '2026-11-07'))).toEqual({ label: '', day: '2026-11-07' });
  });
});

describe('formatting', () => {
  it('reads server times as wall-clock values', () => {
    expect(dayOf('2026-11-01 10:30:00')).toBe('2026-11-01');
    expect(dayOf('2026-11-01T10:30:00+02:00')).toBe('2026-11-01');
    expect(dayOf(null)).toBeNull();
    expect(formatClock('2026-11-01 10:30:00')).toBe('10:30');
    expect(formatClock('2026-11-01')).toBe('');
  });
  it('shows weekday and date in the app language', () => {
    expect(formatDay('2026-10-31 10:30:00', 'en')).toBe('Sat, Oct 31');
    expect(formatDayTime('2026-10-31 10:30:00', 'en')).toBe('Sat, Oct 31 10:30');
    expect(formatDay('2026-10-31', 'fi')).toMatch(/31/);
    expect(formatDay('garbage', 'en')).toBe('');
    expect(formatDayTime(null, 'en')).toBe('');
  });
});

describe('rememberLink', () => {
  async function setup() {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    const db: Db = {
      execAsync: async (s) => void raw.exec(s),
      getFirstAsync: async (s, ...p) => (raw.prepare(s).get(...(p as never[])) as never) ?? null,
      getAllAsync: async (s, ...p) => raw.prepare(s).all(...(p as never[])) as never,
      runAsync: async (s, ...p) => raw.prepare(s).run(...(p as never[])),
      withTransactionAsync: async (t) => {
        raw.exec('BEGIN');
        await t();
        raw.exec('COMMIT');
      },
    };
    await migrate(db);
    const repo = createRepo(db);
    const server = await repo.upsertServer('https://a.org', 'a.org', 0);
    const tokens = new Map<number, string>();
    const deps = (linkToken: string, data: Discovery, now: number) => ({
      repo,
      serverId: server.id,
      linkToken,
      data,
      getToken: async (id: number) => tokens.get(id) ?? null,
      saveToken: async (id: number, t: string) => void tokens.set(id, t),
      now,
    });
    return { repo, tokens, deps };
  }
  const data = list([game(1, '2026-11-01 10:00:00', 'F1'), game(2, null, 'F1')]);

  it('saves a new link with its token in secure storage only', async () => {
    const { repo, tokens, deps } = await setup();
    const id = await rememberLink(deps('a'.repeat(32), data, 5));
    expect(tokens.get(id)).toBe('a'.repeat(32));
    expect(await repo.listLinks()).toEqual([
      expect.objectContaining({ id, label: 'F1', day: '2026-11-01', usedAt: 5 }),
    ]);
  });
  it('refreshes the same link instead of adding it twice', async () => {
    const { repo, deps } = await setup();
    const a = await rememberLink(deps('a'.repeat(32), data, 5));
    const b = await rememberLink(deps('b'.repeat(32), data, 6));
    expect(await rememberLink(deps('a'.repeat(32), data, 7))).toBe(a);
    expect((await repo.listLinks()).map((l) => [l.id, l.usedAt])).toEqual([
      [a, 7],
      [b, 6],
    ]);
  });
});
