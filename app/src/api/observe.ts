/**
 * A window onto the app's API calls, for the internal bug reporter's trail (features/bug-report/
 * trail.ts): which `BeviApi` method ran, whether it failed, with which code, and how long it took.
 * Never the arguments, never the result.
 *
 * `observed(api)` is wrapped around the client once (client.ts). Until someone calls
 * `setApiListener`, which only the reporter does and only for an internal account, a call through
 * the wrapper costs one null check and nothing is measured or kept.
 */

/** One settled call. */
export interface ApiCall {
  /** The method as the contract names it: 'rankings.submit', 'signIn'. */
  method: string;
  ok: boolean;
  /** The `ApiError` code of a failed call, when the error carried one. */
  code?: string;
  /** The HTTP status of a failed call, when the error carried one. */
  status?: number;
  /** How long it took to settle. */
  ms: number;
}

export type ApiListener = (call: ApiCall) => void;

let listener: ApiListener | null = null;

/** Sets the one listener, or removes it with null. */
export function setApiListener(next: ApiListener | null): void {
  listener = next;
}

const now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function report(to: ApiListener, method: string, startedAt: number, failure?: { error: unknown }): void {
  try {
    const call: ApiCall = { method, ok: !failure, ms: Math.max(0, Math.round(now() - startedAt)) };
    if (failure) {
      const error = failure.error as { code?: unknown; status?: unknown; detail?: { status?: unknown } | null } | null;
      if (typeof error?.code === 'string') call.code = error.code;
      const status = typeof error?.status === 'number' ? error.status : error?.detail?.status;
      if (typeof status === 'number') call.status = status;
    }
    to(call);
  } catch {
    // A listener that throws must never change what the caller of the API sees.
  }
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * `fn` with the same arguments, `this`, result and rejection, reported to the listener once it
 * settles. `self` is the object the method lives on and `proxy` is what callers hold instead of
 * it, so a method that reads `this` still gets the real object.
 */
function wrapMethod(fn: AnyFunction, method: string, self: object, proxy: () => object): AnyFunction {
  return function observedMethod(this: unknown, ...args: unknown[]): unknown {
    const receiver = this === proxy() ? self : this;
    const to = listener;
    if (to === null) return fn.apply(receiver, args);

    const startedAt = now();
    let result: unknown;
    try {
      result = fn.apply(receiver, args);
    } catch (error) {
      report(to, method, startedAt, { error });
      throw error;
    }
    if (isThenable(result)) {
      // A side branch: the caller gets the method's own promise back, untouched, and this branch
      // handles its own copy of a rejection so it never surfaces as an unhandled one.
      result.then(
        () => report(to, method, startedAt),
        (error: unknown) => report(to, method, startedAt, { error }),
      );
    } else {
      report(to, method, startedAt);
    }
    return result;
  };
}

/**
 * A proxy over one object that hands out its functions wrapped (and, at the top level, its
 * namespace objects proxied the same way). What it hands out is cached per property, so
 * `api.bugs === api.bugs` and `api.bugs.submit === api.bugs.submit`: hooks depend on that.
 */
function observeObject<T extends object>(target: T, prefix: string, depth: number): T {
  const cache = new Map<PropertyKey, { from: unknown; to: unknown }>();
  const proxy: T = new Proxy(target, {
    get(obj, prop, receiver) {
      const value: unknown = Reflect.get(obj, prop, receiver === proxy ? obj : receiver);
      if (typeof prop !== 'string' || value === null || (typeof value !== 'function' && typeof value !== 'object')) return value;
      const cached = cache.get(prop);
      if (cached && cached.from === value) return cached.to;

      let to: unknown = value;
      if (typeof value === 'function') {
        to = wrapMethod(value as AnyFunction, prefix + prop, obj, () => proxy);
      } else if (depth === 0 && isPlainObject(value)) {
        to = observeObject(value, `${prop}.`, 1);
      }
      cache.set(prop, { from: value, to });
      return to;
    },
  });
  return proxy;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `api` with every method reachable as `api.x(...)` or `api.x.y(...)` reported to the listener
 * when one is set. Everything else about it is unchanged.
 */
export function observed<T extends object>(api: T): T {
  return observeObject(api, '', 0);
}
