import { describe, expect, it, vi } from 'vitest';
import type { BevSummary } from '@bevi/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyGeneratedIcons, withGeneratedIcons } from '../src/generatedIcons.ts';

type IconRow = {
  bev_id: string;
  generated_icon_path: string | null;
  icon_status: string;
  fallback_icon_path: string | null;
  icon_label_band: { x: number; y: number; width: number; height: number; dark: boolean } | null;
};

const BAND = { x: 0.33, y: 0.29, width: 0.34, height: 0.25, dark: true };

/** A client whose only jobs are `rpc('get_bev_icons')` and public URLs. */
function fakeClient(rows: IconRow[] | { error: unknown }) {
  const rpc = vi.fn(async (_fn: string, _args: unknown) =>
    Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error },
  );
  const client = {
    rpc,
    storage: {
      from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${bucket}/${path}` } }) }),
    },
  } as unknown as SupabaseClient;
  return { client, rpc };
}

function summary(id: string, over: Partial<BevSummary> = {}): BevSummary {
  return {
    id,
    name: 'Mango Sparkler',
    brand: 'Acme',
    flavor: null,
    categoryId: 'soda',
    photoUrl: 'https://cdn/bev-photos/photo.jpg',
    iconUrl: null,
    iconLabelBand: null,
    photoStatus: 'ready',
    priceTier: 2,
    priceEstimated: false,
    ratingCount: 0,
    bayesScore: null,
    ...over,
  };
}

const completed = (id: string): IconRow => ({
  bev_id: id,
  generated_icon_path: `${id}/icon-1024.png`,
  icon_status: 'completed',
  fallback_icon_path: null,
  icon_label_band: BAND,
});

describe('filling a summary with the Bev\'s generated icon', () => {
  it('puts the generated icon in the icon slot, with the band to letter it', async () => {
    const { client } = fakeClient([completed('bev-1')]);
    const rows = [summary('bev-1')];
    await applyGeneratedIcons(client, rows);
    expect(rows[0].iconUrl).toBe('https://cdn/bev-generated-icons/bev-1/icon-1024.png');
    expect(rows[0].iconLabelBand).toEqual(BAND);
    // The photograph is untouched: the detail screen still opens it.
    expect(rows[0].photoUrl).toBe('https://cdn/bev-photos/photo.jpg');
  });

  it.each(['pending', 'processing', 'failed', 'none'])('leaves a %s Bev showing what it showed before', async (status) => {
    const { client } = fakeClient([
      { bev_id: 'bev-1', generated_icon_path: null, icon_status: status, fallback_icon_path: 'other-bev/icon.svg', icon_label_band: null },
    ]);
    const rows = [summary('bev-1')];
    await applyGeneratedIcons(client, rows);
    expect(rows[0].iconUrl).toBeNull();
    expect(rows[0].iconLabelBand).toBeNull();
  });

  // fallbackIconUrl is another drink's art. Showing it in place of this Bev's own
  // photograph would be a downgrade, so the fold ignores it entirely.
  it('never borrows another Bev\'s catalogue icon', async () => {
    const { client } = fakeClient([
      { bev_id: 'bev-1', generated_icon_path: null, icon_status: 'pending', fallback_icon_path: 'cola/icon.svg', icon_label_band: null },
    ]);
    const rows = [summary('bev-1')];
    await applyGeneratedIcons(client, rows);
    expect(rows[0].iconUrl).toBeNull();
  });

  it('keeps the authored catalogue icon a seeded Bev already has', async () => {
    const { client } = fakeClient([]);
    const rows = [summary('bev-1', { iconUrl: 'https://cdn/bev-icons/cola/icon.svg', photoUrl: null })];
    await applyGeneratedIcons(client, rows);
    expect(rows[0].iconUrl).toBe('https://cdn/bev-icons/cola/icon.svg');
  });

  it('refuses a completed row with no path, rather than rendering a broken image', async () => {
    const { client } = fakeClient([
      { bev_id: 'bev-1', generated_icon_path: null, icon_status: 'completed', fallback_icon_path: null, icon_label_band: BAND },
    ]);
    const rows = [summary('bev-1')];
    await applyGeneratedIcons(client, rows);
    expect(rows[0].iconUrl).toBeNull();
  });

  it('asks once for a Bev that appears several times in one result', async () => {
    const { client, rpc } = fakeClient([completed('bev-1')]);
    const rows = [summary('bev-1'), summary('bev-1'), summary('bev-2')];
    await applyGeneratedIcons(client, rows);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toEqual({ p_bev_ids: ['bev-1', 'bev-2'] });
    // Both copies of the same Bev are filled, not just the first.
    expect(rows[1].iconUrl).toBe('https://cdn/bev-generated-icons/bev-1/icon-1024.png');
    expect(rows[2].iconUrl).toBeNull();
  });

  // get_bev_icons rejects more than 500 ids as the caller's bug (20261119185801).
  it('splits a long list into calls the RPC accepts', async () => {
    const { client, rpc } = fakeClient([]);
    await applyGeneratedIcons(client, Array.from({ length: 501 }, (_, i) => summary(`bev-${i}`)));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((rpc.mock.calls[0][1] as { p_bev_ids: string[] }).p_bev_ids).toHaveLength(500);
    expect((rpc.mock.calls[1][1] as { p_bev_ids: string[] }).p_bev_ids).toHaveLength(1);
  });

  it('makes no call at all for a result with no Bevs in it', async () => {
    const { client, rpc } = fakeClient([]);
    await applyGeneratedIcons(client, []);
    expect(rpc).not.toHaveBeenCalled();
  });

  // An anonymous caller, or a database without 20261119185801: the screen still
  // draws, with the photograph it drew before this existed.
  it('fails soft, leaving every summary as the RPC gave it', async () => {
    const { client } = fakeClient({ error: { message: 'BEVI_UNAUTHORIZED', code: '42501' } });
    const rows = [summary('bev-1')];
    await expect(applyGeneratedIcons(client, rows)).resolves.toBeUndefined();
    expect(rows[0].iconUrl).toBeNull();
  });
});

describe('the whole API is covered, not a list of remembered methods', () => {
  it('fills a summary wherever it is nested in a method\'s result', async () => {
    const { client } = fakeClient([completed('bev-1')]);
    const api = withGeneratedIcons(client, {
      feed: {
        async list() {
          return { items: [{ id: 'post-1', bev: summary('bev-1') }], nextCursor: null };
        },
      },
      snapshot: {
        async get() {
          return { summaries: new Map([['bev-1', summary('bev-1')]]) };
        },
      },
      meta: { contractVersion: () => '3.0.0' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await (api as any).feed.list()) as { items: { bev: BevSummary }[] };
    expect(page.items[0].bev.iconUrl).toBe('https://cdn/bev-generated-icons/bev-1/icon-1024.png');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot = (await (api as any).snapshot.get()) as { summaries: Map<string, BevSummary> };
    expect(snapshot.summaries.get('bev-1')?.iconUrl).toBe('https://cdn/bev-generated-icons/bev-1/icon-1024.png');
  });

  it('leaves a synchronous method synchronous, and asks nothing for a Bev-less result', async () => {
    const { client, rpc } = fakeClient([]);
    const api = withGeneratedIcons(client, {
      meta: { contractVersion: () => '3.0.0' },
      profile: { async me() { return { id: 'u1', username: 'arjun' }; } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((api as any).meta.contractVersion()).toBe('3.0.0');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (api as any).profile.me();
    expect(rpc).not.toHaveBeenCalled();
  });
});
