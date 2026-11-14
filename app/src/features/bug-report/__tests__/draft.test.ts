import {
  clearDraft,
  DOCK_KEY,
  DRAFT_KEY,
  DRAFT_MAX_AGE_MS,
  loadDock,
  loadDraft,
  loadUnplaced,
  newIdempotencyKey,
  saveDock,
  saveDraft,
  saveUnplaced,
  UNPLACED_KEY,
  type StorageLike,
} from '../draft';

function memory(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const KEY = '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11';
const NOW = new Date('2026-11-02T12:00:00.000Z');
const MARK = {
  n: 1,
  title: 'TabBar › Add Bev',
  target: { component: 'TabBar', label: 'Add Bev', rect: { x: 1, y: 2, width: 3, height: 4 } },
  route: '/feed',
};

describe('the bug-report draft', () => {
  it('round-trips the text, the pinned kind, the marks and the key the draft files under', () => {
    const store = memory();
    saveDraft(store, { text: 'Too heavy', kindOverride: 'design', marks: [MARK], includeSteps: false, idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, NOW)).toEqual({
      text: 'Too heavy',
      kindOverride: 'design',
      marks: [MARK],
      includeSteps: false,
      idempotencyKey: KEY,
      savedAt: NOW.toISOString(),
    });
  });

  it('never persists a picture, only text and what was pointed at', () => {
    const store = memory();
    saveDraft(store, { text: 'x', marks: [MARK], idempotencyKey: KEY }, NOW);
    const stored = JSON.parse(store.map.get(DRAFT_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['idempotencyKey', 'marks', 'savedAt', 'text']);
    expect(Object.keys((stored.marks as object[])[0]!).sort()).toEqual(['n', 'route', 'target', 'title']);
  });

  it('maps a draft the old form saved (title, description) into the note text', () => {
    const old = {
      kind: 'bug',
      severity: 'bad',
      title: 'Ratings vanish',
      description: 'after a refresh',
      steps: '',
      idempotencyKey: KEY,
      savedAt: NOW.toISOString(),
    };
    expect(loadDraft(memory({ [DRAFT_KEY]: JSON.stringify(old) }), NOW)).toEqual({
      text: 'Ratings vanish\n\nafter a refresh',
      marks: [],
      idempotencyKey: KEY,
      savedAt: NOW.toISOString(),
    });
  });

  it('keeps typed steps from an old draft too, rather than dropping them', () => {
    const old = { title: 'Crash', description: '', steps: '1. Open\n2. Tap', idempotencyKey: KEY, savedAt: NOW.toISOString() };
    expect(loadDraft(memory({ [DRAFT_KEY]: JSON.stringify(old) }), NOW)?.text).toBe('Crash\n\n1. Open\n2. Tap');
  });

  it('drops marks it cannot read and an unknown kind', () => {
    const raw = { text: 'x', kindOverride: 'nope', marks: [MARK, { title: 'no target' }, 3], idempotencyKey: KEY, savedAt: NOW.toISOString() };
    expect(loadDraft(memory({ [DRAFT_KEY]: JSON.stringify(raw) }), NOW)).toEqual({
      text: 'x',
      marks: [MARK],
      idempotencyKey: KEY,
      savedAt: NOW.toISOString(),
    });
  });

  it('drops an empty draft rather than keeping a used-looking key', () => {
    const store = memory();
    saveDraft(store, { text: 'x', marks: [], idempotencyKey: KEY }, NOW);
    saveDraft(store, { text: '   ', marks: [], idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, NOW)).toBeNull();
  });

  it('keeps a draft with only a mark', () => {
    const store = memory();
    saveDraft(store, { text: '', marks: [MARK], idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, NOW)?.marks).toEqual([MARK]);
  });

  it('forgets a draft older than a day instead of restoring something stale', () => {
    const store = memory();
    saveDraft(store, { text: 'x', marks: [], idempotencyKey: KEY }, NOW);
    const later = new Date(NOW.getTime() + DRAFT_MAX_AGE_MS + 1000);
    expect(loadDraft(store, later)).toBeNull();
    expect(store.map.has(DRAFT_KEY)).toBe(false);
  });

  it('still restores a draft just under a day old', () => {
    const store = memory();
    saveDraft(store, { text: 'x', marks: [], idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, new Date(NOW.getTime() + DRAFT_MAX_AGE_MS - 1000))?.text).toBe('x');
  });

  it('ignores a corrupted or keyless draft', () => {
    expect(loadDraft(memory({ [DRAFT_KEY]: 'not json' }), NOW)).toBeNull();
    expect(loadDraft(memory({ [DRAFT_KEY]: JSON.stringify({ text: 'x', savedAt: NOW.toISOString() }) }), NOW)).toBeNull();
  });

  it('survives storage that throws, which is what private-mode Safari does', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadDraft(throwing, NOW)).toBeNull();
    expect(() => saveDraft(throwing, { text: 'x', marks: [], idempotencyKey: KEY }, NOW)).not.toThrow();
    expect(() => clearDraft(throwing)).not.toThrow();
    expect(loadUnplaced(throwing)).toEqual([]);
    expect(() => saveUnplaced(throwing, ['BEV-1'])).not.toThrow();
  });

  it('tolerates having no storage at all', () => {
    expect(loadDraft(null)).toBeNull();
    expect(() => saveDraft(null, { text: 'x', marks: [], idempotencyKey: KEY })).not.toThrow();
  });
});

describe('the tickets to place and the dock', () => {
  it('keeps the unplaced ticket ids under their own key, without repeats, and clears an empty list', () => {
    const store = memory();
    saveUnplaced(store, ['BEV-1', 'BEV-2']);
    expect(JSON.parse(store.map.get(UNPLACED_KEY)!)).toEqual(['BEV-1', 'BEV-2']);
    expect(loadUnplaced(memory({ [UNPLACED_KEY]: JSON.stringify(['BEV-1', 'BEV-1', 4, '']) }))).toEqual(['BEV-1']);
    saveUnplaced(store, []);
    expect(store.map.has(UNPLACED_KEY)).toBe(false);
  });

  it('remembers where the drop docks, and ignores a malformed value', () => {
    const store = memory();
    saveDock(store, { side: 'left', bottom: 200 });
    expect(loadDock(store)).toEqual({ side: 'left', bottom: 200 });
    expect(loadDock(memory({ [DOCK_KEY]: JSON.stringify({ side: 'top', bottom: 1 }) }))).toBeNull();
  });
});

describe('newIdempotencyKey', () => {
  it('is a v4 UUID, which is the shape the server requires', () => {
    for (let i = 0; i < 20; i++) {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
    expect(keys.size).toBe(50);
  });
});
