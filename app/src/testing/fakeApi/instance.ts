import { FakeApi } from './FakeApi';

let instance: FakeApi | null = null;

/** The suites' single FakeApi (memory only, 200–600 ms latency until a suite sets it). Created on first use. */
export function getFakeApi(): FakeApi {
  instance ??= new FakeApi();
  return instance;
}
