/** @jest-environment jsdom */
import { act } from 'react';
// Minimal test bridge; the workspace does not install @types/react-dom.
type TestRoot = { render(node: React.ReactNode): void; unmount(): void };
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): TestRoot };
import { BarcodeCamera } from '../BarcodeCamera.web';

const mockDecode = jest.fn();
jest.mock('../barcodeReader', () => ({ loadBarcodeReader: async () => ({ decodeFromStream: mockDecode }) }));
let root: TestRoot;
let container: HTMLDivElement;
let getUserMedia: jest.Mock;
const stop = jest.fn();
const stream = { getTracks: () => [{ stop }] };
beforeEach(() => {
  stop.mockClear(); mockDecode.mockReset();
  getUserMedia = jest.fn();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
it('stops a stream granted after the scanner has already closed', async () => {
  let grant!: (value: unknown) => void;
  getUserMedia.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
  act(() => root.render(<BarcodeCamera onBarcode={jest.fn()} onError={jest.fn()} />));
  act(() => root.render(null));
  await act(async () => grant(stream));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mockDecode).not.toHaveBeenCalled();
});
it('accepts one barcode and releases camera tracks before delivering it', async () => {
  getUserMedia.mockResolvedValue(stream);
  const scanner = { stop: jest.fn() };
  mockDecode.mockResolvedValue(scanner);
  const onBarcode = jest.fn(() => expect(stop).toHaveBeenCalled());
  await act(async () => root.render(<BarcodeCamera onBarcode={onBarcode} onError={jest.fn()} />));
  const callback = mockDecode.mock.calls[0]![2];
  act(() => {
    callback({ getText: () => '012345678901' }, null, scanner);
    callback({ getText: () => '012345678901' }, null, scanner);
  });
  expect(onBarcode).toHaveBeenCalledTimes(1);
  expect(onBarcode).toHaveBeenCalledWith('012345678901');
});
it('stops scanning on browser back', async () => {
  getUserMedia.mockResolvedValue(stream);
  mockDecode.mockResolvedValue({ stop: jest.fn() });
  const onError = jest.fn();
  await act(async () => root.render(<BarcodeCamera onBarcode={jest.fn()} onError={onError} />));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(stop).toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Camera paused'));
});
