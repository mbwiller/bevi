import { MockApi } from './MockApi';

let instance: MockApi | null = null;

/** The app's single MockApi (localStorage-persisted on web, 200–600 ms latency). Created on first use. */
export function getMockApi(): MockApi {
  instance ??= new MockApi();
  return instance;
}
