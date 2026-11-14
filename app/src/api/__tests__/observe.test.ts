import { ApiError } from '@bevi/shared';

import { observed, setApiListener, type ApiCall } from '../observe';

// `@/api/client` is the FakeApi under jest (jest.setup.js), so the wrapper is tested on plain objects.

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function listen(): ApiCall[] {
  const calls: ApiCall[] = [];
  setApiListener((call) => calls.push(call));
  return calls;
}

afterEach(() => setApiListener(null));

describe('observed', () => {
  it('reports a successful call by its contract name, and hands back the same promise', async () => {
    const promise = Promise.resolve({ id: 'r1' });
    const api = observed({ rankings: { submit: jest.fn((_bevId: string) => promise) }, signIn: () => Promise.resolve('session') });
    const calls = listen();

    const returned = api.rankings.submit('bev-1');
    expect(returned).toBe(promise);
    await expect(returned).resolves.toEqual({ id: 'r1' });
    await expect(api.signIn()).resolves.toBe('session');
    await settle();

    expect(calls).toEqual([
      { method: 'rankings.submit', ok: true, ms: expect.any(Number) },
      { method: 'signIn', ok: true, ms: expect.any(Number) },
    ]);
    expect(calls[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports a rejection with the ApiError code, and the caller still gets the same rejection', async () => {
    const error = new ApiError('rate_limited', 'Too many reports in the last hour');
    const api = observed({
      bugs: {
        submit: () => Promise.reject(error),
        status: () => Promise.reject(Object.assign(new Error('gateway'), { status: 502 })),
        rank: () => Promise.reject(new ApiError('unknown', 'x', { status: 503 })),
        odd: () => Promise.reject('just a string'),
      },
    });
    const calls = listen();

    await expect(api.bugs.submit()).rejects.toBe(error);
    await expect(api.bugs.status()).rejects.toThrow('gateway');
    await expect(api.bugs.rank()).rejects.toThrow('x');
    await expect(api.bugs.odd()).rejects.toBe('just a string');
    await settle();

    expect(calls).toEqual([
      { method: 'bugs.submit', ok: false, code: 'rate_limited', ms: expect.any(Number) },
      { method: 'bugs.status', ok: false, status: 502, ms: expect.any(Number) },
      { method: 'bugs.rank', ok: false, code: 'unknown', status: 503, ms: expect.any(Number) },
      { method: 'bugs.odd', ok: false, ms: expect.any(Number) },
    ]);
    // Never the message, never an argument.
    expect(JSON.stringify(calls)).not.toContain('Too many');
  });

  it('does not turn a rejection the caller handles into an unhandled one', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const api = observed({ x: { fail: () => Promise.reject(new ApiError('network', 'offline')) } });
    listen();
    await api.x.fail().catch(() => {});
    await settle();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('reports a method that returns or throws without a promise', () => {
    const boom = new Error('sync');
    const api = observed({
      onAuthChange: (_listener: () => void) => () => {},
      meta: {
        version: () => '2.13.0',
        explode: (): never => {
          throw boom;
        },
      },
    });
    const calls = listen();
    expect(typeof api.onAuthChange(() => {})).toBe('function');
    expect(api.meta.version()).toBe('2.13.0');
    expect(() => api.meta.explode()).toThrow(boom);
    expect(calls.map((call) => [call.method, call.ok])).toEqual([
      ['onAuthChange', true],
      ['meta.version', true],
      ['meta.explode', false],
    ]);
  });

  it('keeps identity stable: the same namespace and the same method every time', () => {
    const api = observed({ bugs: { submit: () => Promise.resolve(1) }, feed: { list: () => Promise.resolve([]) }, signOut: () => Promise.resolve() });
    expect(api.bugs).toBe(api.bugs);
    expect(api.bugs.submit).toBe(api.bugs.submit);
    expect(api.signOut).toBe(api.signOut);
    expect(api.bugs).not.toBe(api.feed);
    const { bugs } = api;
    listen();
    expect(bugs).toBe(api.bugs);
  });

  it('wraps again when a method is replaced', async () => {
    const target = { bugs: { submit: () => Promise.resolve('first') } };
    const api = observed(target);
    const before = api.bugs.submit;
    target.bugs.submit = () => Promise.resolve('second');
    expect(api.bugs.submit).not.toBe(before);
    await expect(api.bugs.submit()).resolves.toBe('second');
  });

  it('calls the method with the real object as `this`, and passes its arguments through', async () => {
    const seen: unknown[] = [];
    const target = {
      base: 'https://example.test',
      bevs: {
        prefix: 'bev:',
        get(this: { prefix: string }, id: string, extra?: number) {
          seen.push(this, id, extra);
          return Promise.resolve(this.prefix + id);
        },
      },
      whoAmI(this: { base: string }) {
        return this.base;
      },
    };
    const api = observed(target);
    listen();
    await expect(api.bevs.get('7', 2)).resolves.toBe('bev:7');
    expect(seen).toEqual([target.bevs, '7', 2]);
    expect(api.whoAmI()).toBe('https://example.test');
    // Detached, as a hook might hold it: `this` is whatever the caller gives.
    const detached = api.bevs.get;
    await expect(detached.call({ prefix: 'other:' }, '9')).resolves.toBe('other:9');
  });

  it('passes everything that is not a method or a namespace through untouched', () => {
    const date = new Date(0);
    const list = [1, 2, 3];
    const deep = { inner: { fn: () => 'raw' } };
    const target = { version: '2.13.0', retries: 3, on: true, nothing: null, missing: undefined, date, list, deep, [Symbol.for('s')]: 'sym' };
    const api = observed(target);
    expect(api.version).toBe('2.13.0');
    expect(api.retries).toBe(3);
    expect(api.on).toBe(true);
    expect(api.nothing).toBeNull();
    expect(api.missing).toBeUndefined();
    expect(api.date).toBe(date);
    expect(api.list).toBe(list);
    expect((api as unknown as Record<symbol, string>)[Symbol.for('s')]).toBe('sym');
    expect('version' in api).toBe(true);
    expect(Object.keys(api)).toEqual(Object.keys(target));
    // Only api.x(...) and api.x.y(...) are observed: a third level is the object itself.
    const calls = listen();
    expect(api.deep.inner).toBe(deep.inner);
    expect(api.deep.inner.fn()).toBe('raw');
    expect(calls).toEqual([]);
  });

  it('does nothing but call through without a listener', async () => {
    const promise = Promise.resolve('ok');
    const then = jest.spyOn(promise, 'then');
    const submit = jest.fn(() => promise);
    const api = observed({ bugs: { submit } });

    // No listener: the method's own promise comes back and nothing is hung on it.
    expect(api.bugs.submit()).toBe(promise);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(then).not.toHaveBeenCalled();

    // A listener set later sees later calls only; one that is removed sees none.
    const calls = listen();
    expect(api.bugs.submit()).toBe(promise);
    expect(then).toHaveBeenCalledTimes(1);
    setApiListener(null);
    expect(api.bugs.submit()).toBe(promise);
    expect(then).toHaveBeenCalledTimes(1);
    await settle();
    expect(calls).toEqual([{ method: 'bugs.submit', ok: true, ms: expect.any(Number) }]);
  });

  it('never lets a listener that throws change what the caller sees', async () => {
    setApiListener(() => {
      throw new Error('listener bug');
    });
    const api = observed({ bugs: { submit: () => Promise.resolve('ok'), fail: () => Promise.reject(new ApiError('network', 'offline')) } });
    await expect(api.bugs.submit()).resolves.toBe('ok');
    await expect(api.bugs.fail()).rejects.toThrow('offline');
    await settle();
  });
});
