/**
 * @jest-environment jsdom
 */
// SPIKE S1: the DOM island under jest. React Native Testing Library cannot render DOM (it throws on a
// <p>), so this mounts with react-dom's createRoot and act, and reads class names through the CSS
// module mapper (jest.cssModule.js). It proves the import and the wiring, and nothing about CSS.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { EDGE_STRIP } from '@/components/StatusBarClearance';

import { clearLog, log } from '../log';
import { SpikeOverlay } from '../SpikeOverlay.web';
import type { SpikeOverlayProps } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeStream() {
  const track = { readyState: 'live', addEventListener: jest.fn(), removeEventListener: jest.fn(), stop: jest.fn() };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

let host: HTMLDivElement;
let root: Root;

function mount(props: Partial<SpikeOverlayProps> = {}) {
  const all: SpikeOverlayProps = {
    stream: null,
    topEdge: 'clearance',
    contextTop: 0,
    accuracyM: null,
    onExit: jest.fn(),
    onCameraLost: jest.fn(),
    ...props,
  };
  act(() => root.render(<SpikeOverlay {...all} />));
  return all;
}

beforeEach(() => {
  // jsdom has no media playback.
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  clearLog();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.restoreAllMocks();
});

it('imports a CSS module and puts its class names on DOM elements', () => {
  mount();
  expect(host.querySelector('video')?.className).toBe('camera');
  expect(host.querySelector('[data-testid="spike-overlay"]')?.className).toBe('screen');
  expect(host.querySelector('button')?.className).toBe('exit');
  expect(host.querySelector('pre')?.className).toBe('log');
});

it('plays the camera inline and muted, and lets go of the stream on unmount', async () => {
  const stream = fakeStream();
  mount({ stream });
  const video = host.querySelector('video') as HTMLVideoElement & { srcObject: unknown };
  expect(video.srcObject).toBe(stream);
  expect(video.muted).toBe(true);
  expect(video.hasAttribute('playsinline')).toBe(true);
  await act(async () => {});
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  act(() => root.render(<></>));
  expect(video.srcObject).toBeNull();
});

it('ends the trip from the ×', () => {
  const { onExit } = mount();
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="End navigation"]')!.click());
  expect(onExit).toHaveBeenCalledTimes(1);
});

it("takes its top inset from Bevi's context, from CSS env(), or starts below the edge strip", () => {
  const overlay = () => host.querySelector<HTMLDivElement>('[data-testid="spike-overlay"]')!;
  mount({ topEdge: 'clearance', contextTop: 102 });
  expect(overlay().style.getPropertyValue('--safe-top')).toBe('102px');
  expect(overlay().style.top).toBe('0px');
  mount({ topEdge: 'env', contextTop: 102 });
  expect(overlay().style.getPropertyValue('--safe-top')).toBe('env(safe-area-inset-top, 0px)');
  mount({ topEdge: 'below-strip', contextTop: 102 });
  expect(overlay().style.getPropertyValue('--safe-top')).toBe('0px');
  expect(overlay().style.top).toBe(`${EDGE_STRIP}px`);
});

it('shows the tail of the log over the camera', () => {
  mount();
  act(() => log('motion permission: granted after 12 ms'));
  expect(host.querySelector('pre')?.textContent).toContain('motion permission: granted after 12 ms');
});

it('stops pinch-zoom only while it is mounted', () => {
  mount();
  const during = new Event('gesturestart', { cancelable: true });
  document.dispatchEvent(during);
  expect(during.defaultPrevented).toBe(true);
  act(() => root.render(<></>));
  const after = new Event('gesturestart', { cancelable: true });
  document.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
