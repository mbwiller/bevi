import {
  clearDraft,
  DRAFT_KEY,
  DRAFT_MAX_AGE_MS,
  loadDraft,
  newIdempotencyKey,
  parseSteps,
  saveDraft,
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

describe('the bug-report draft', () => {
  it('round-trips the typed fields and the key the draft files under', () => {
    const store = memory();
    saveDraft(store, { title: 'Ratings vanish', description: 'after a refresh', steps: '', idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, NOW)).toEqual({
      title: 'Ratings vanish',
      description: 'after a refresh',
      steps: '',
      idempotencyKey: KEY,
      savedAt: NOW.toISOString(),
    });
  });

  it('never persists an attachment, only text', () => {
    const store = memory();
    saveDraft(store, { title: 'x', description: '', steps: '', idempotencyKey: KEY }, NOW);
    const stored = JSON.parse(store.map.get(DRAFT_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['description', 'idempotencyKey', 'savedAt', 'steps', 'title']);
  });

  it('drops an empty draft rather than keeping a used-looking key', () => {
    const store = memory();
    saveDraft(store, { title: 'x', description: '', steps: '', idempotencyKey: KEY }, NOW);
    saveDraft(store, { title: '   ', description: '', steps: '\n', idempotencyKey: KEY }, NOW);
    expect(loadDraft(store, NOW)).toBeNull();
  });

  it('forgets a draft older than a day instead of restoring something stale', () => {
    const store = memory();
    saveDraft(store, { title: 'x', description: '', steps: '', idempotencyKey: KEY }, NOW);
    const later = new Date(NOW.getTime() + DRAFT_MAX_AGE_MS + 1000);
    expect(loadDraft(store, later)).toBeNull();
    expect(store.map.has(DRAFT_KEY)).toBe(false);
  });

  it('ignores a corrupted or keyless draft', () => {
    expect(loadDraft(memory({ [DRAFT_KEY]: 'not json' }), NOW)).toBeNull();
    expect(loadDraft(memory({ [DRAFT_KEY]: JSON.stringify({ title: 'x', savedAt: NOW.toISOString() }) }), NOW)).toBeNull();
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
    expect(() => saveDraft(throwing, { title: 'x', description: '', steps: '', idempotencyKey: KEY }, NOW)).not.toThrow();
    expect(() => clearDraft(throwing)).not.toThrow();
  });

  it('tolerates having no storage at all', () => {
    expect(loadDraft(null)).toBeNull();
    expect(() => saveDraft(null, { title: 'x', description: '', steps: '', idempotencyKey: KEY })).not.toThrow();
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

describe('parseSteps', () => {
  it('splits on lines and strips the numbering people paste in', () => {
    expect(parseSteps('1. Open a Bev\n2) Rate it\n- Refresh\n• Look\n\n  \n* Again')).toEqual([
      'Open a Bev',
      'Rate it',
      'Refresh',
      'Look',
      'Again',
    ]);
  });

  it('is empty for an empty field', () => {
    expect(parseSteps('')).toEqual([]);
    expect(parseSteps('   \n  ')).toEqual([]);
  });
});
