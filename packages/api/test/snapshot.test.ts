// S-21 + Stage 4: `toViewerSnapshot` maps the two keys get_prediction_snapshot()
// gained in 20261101000100 -- `edges` ([src, dst, w]) onto `snapshot.edges` and
// `userNeighbors` ([alias, sim, common]) onto `snapshot.userNeighbours` keyed by
// the viewer -- and sets each field only when its key is present. The SQL side
// is covered by supabase/tests/17_snapshot_edges_neighbours.test.sql.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toViewerSnapshot } from '../src/snapshot.ts';

type SnapshotJson = Parameters<typeof toViewerSnapshot>[1];

const VIEWER = '00000000-0000-4000-8000-0000000b2101';
const BEV_A = '00000000-0000-4000-8000-00000000a001';
const BEV_B = '00000000-0000-4000-8000-00000000a002';

// `publicUrl` is the only thing the mapper asks of the client.
const client = {
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
} as unknown as SupabaseClient;

function baseJson(): SnapshotJson {
  return {
    generatedAt: '2026-11-01T00:00:00Z',
    viewer: { id: VIEWER, timezone: 'UTC', canSeeAlcohol: true, rankingCount: 1 },
    global: { n: 2, mean: '7.0', stddev: '1.0', byCategoryMean: { soda: '7.0' } },
    users: [
      [VIEWER, 1, '8.0', '0'],
      ['u2', 1, 6, 0],
    ],
    categoryStats: [
      [VIEWER, 'soda', 1, '8.0', '0'],
      ['u2', 'soda', 1, 6, 0],
    ],
    bevs: [
      [BEV_A, 'Cola', 'Brand', null, 'soda', 2, false, 'a.jpg', false, 2, '7.0', '1.0', '6.9'],
      [BEV_B, 'Lemon Soda', 'Brand', 'lemon', 'soda', 1, true, null, false, 0, null, null, null],
    ],
    rankings: [
      [VIEWER, BEV_A, '8.00'],
      ['u2', BEV_A, 6],
    ],
  };
}

describe('toViewerSnapshot: edges and userNeighbors', () => {
  it('sets neither field when the keys are absent (a pre-S-21 payload)', () => {
    const { snapshot } = toViewerSnapshot(client, baseJson());
    expect('edges' in snapshot).toBe(false);
    expect('userNeighbours' in snapshot).toBe(false);
  });

  it('sets neither field when the keys are null', () => {
    const { snapshot } = toViewerSnapshot(client, { ...baseJson(), edges: null, userNeighbors: null });
    expect('edges' in snapshot).toBe(false);
    expect('userNeighbours' in snapshot).toBe(false);
  });

  it('maps edges: [] to an empty array (provided, none stored)', () => {
    const { snapshot } = toViewerSnapshot(client, { ...baseJson(), edges: [] });
    expect(snapshot.edges).toEqual([]);
    expect('userNeighbours' in snapshot).toBe(false);
  });

  it('maps [src, dst, w] to { a, b, w } with a numeric weight', () => {
    const { snapshot } = toViewerSnapshot(client, {
      ...baseJson(),
      edges: [
        [BEV_A, BEV_B, '0.9001'],
        [BEV_A, '00000000-0000-4000-8000-00000000a003', 0.5],
      ],
    });
    expect(snapshot.edges).toEqual([
      { a: BEV_A, b: BEV_B, w: 0.9001 },
      { a: BEV_A, b: '00000000-0000-4000-8000-00000000a003', w: 0.5 },
    ]);
    expect(typeof snapshot.edges![0]!.w).toBe('number');
  });

  it('maps userNeighbors: [] to { [viewer]: [] }', () => {
    const { snapshot } = toViewerSnapshot(client, { ...baseJson(), userNeighbors: [] });
    expect(snapshot.userNeighbours).toEqual({ [VIEWER]: [] });
    expect('edges' in snapshot).toBe(false);
  });

  it('maps [alias, sim, common] to { userId, sim, common } under the viewer, sim as a number', () => {
    const { snapshot } = toViewerSnapshot(client, {
      ...baseJson(),
      userNeighbors: [
        ['u2', '0.9500', 1],
        ['u5', 0.8, 2],
      ],
    });
    expect(snapshot.userNeighbours).toEqual({
      [VIEWER]: [
        { userId: 'u2', sim: 0.95, common: 1 },
        { userId: 'u5', sim: 0.8, common: 2 },
      ],
    });
    const rows = snapshot.userNeighbours![VIEWER]!;
    expect(typeof rows[0]!.sim).toBe('number');
    expect(Number.isInteger(rows[0]!.common)).toBe(true);
  });

  it('leaves users and rankings unchanged when the new keys are present', () => {
    const plain = toViewerSnapshot(client, baseJson());
    const extended = toViewerSnapshot(client, {
      ...baseJson(),
      edges: [[BEV_A, BEV_B, '0.9001']],
      userNeighbors: [['u2', '0.9500', 1]],
    });
    expect(extended.snapshot.users).toEqual(plain.snapshot.users);
    expect(extended.snapshot.rankings).toEqual(plain.snapshot.rankings);
    expect(extended.snapshot.bevs).toEqual(plain.snapshot.bevs);
    expect(extended.snapshot.global).toEqual(plain.snapshot.global);
    expect(extended.viewer).toEqual(plain.viewer);
    expect([...extended.summaries]).toEqual([...plain.summaries]);
  });
});
