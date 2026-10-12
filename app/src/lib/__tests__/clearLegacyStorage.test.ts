import { clearLegacyStorage } from '../clearLegacyStorage';

function storage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
}

it('removes the old mock database and mock-user recents, and nothing else', () => {
  const s = storage({
    'bevi.mock.db': '{"users":[{"password":"hunter22"}]}',
    'bevi.add.recents:mock-user-demo': '[]',
    'bevi.add.recents:mock-user-jules': '[]',
    'bevi.add.recents:3f1c2f4e-real-user': '[]',
    'sb-abcdefghijklmnop-auth-token': '{}',
  });
  clearLegacyStorage(s);
  expect([...s.data.keys()]).toEqual(['bevi.add.recents:3f1c2f4e-real-user', 'sb-abcdefghijklmnop-auth-token']);
});

it('is idempotent and tolerates missing or broken storage', () => {
  const s = storage({ 'sb-x-auth-token': '{}' });
  clearLegacyStorage(s);
  clearLegacyStorage(s);
  expect([...s.data.keys()]).toEqual(['sb-x-auth-token']);
  expect(clearLegacyStorage(null)).toBe(0);
  const broken = {
    get length(): number {
      throw new Error('SecurityError');
    },
    key: () => null,
    removeItem: () => {},
  };
  expect(() => clearLegacyStorage(broken)).not.toThrow();
});
