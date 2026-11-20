import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { BarcodeCamera } from '../BarcodeCamera';
import { normalizeBarcode } from '../barcodeCommon';

// The native scanner (expo-camera), mocked: jest resolves '../BarcodeCamera' as iOS. The web file
// is covered by BarcodeCamera.web.test.tsx.
type Scan = { type: string; data: string };
let mockPermission: { granted: boolean; canAskAgain: boolean; status: string } | null;
const mockRequest = jest.fn();
let mockAvailable: () => Promise<boolean>;
let cameraProps: { onBarcodeScanned?: (s: Scan) => void; onMountError?: (e: { message: string }) => void; active?: boolean; barcodeScannerSettings?: { barcodeTypes: string[] } } = {};
let cameraMounted = 0;
let cameraUnmounted = 0;
jest.mock('expo-camera', () => {
  const React = require('react');
  function CameraView(props: typeof cameraProps) {
    cameraProps = props;
    React.useEffect(() => { cameraMounted += 1; return () => { cameraUnmounted += 1; }; }, []);
    return null;
  }
  CameraView.isAvailableAsync = () => mockAvailable();
  return { CameraView, useCameraPermissions: () => [mockPermission, mockRequest] };
});

const granted = { granted: true, canAskAgain: true, status: 'granted' };
beforeEach(() => {
  mockPermission = granted;
  mockRequest.mockReset().mockResolvedValue(granted);
  mockAvailable = async () => true;
  cameraProps = {};
  cameraMounted = 0;
  cameraUnmounted = 0;
});

async function scanTwice(code: Scan) {
  await act(async () => { cameraProps.onBarcodeScanned?.(code); cameraProps.onBarcodeScanned?.(code); });
}

describe('normalizeBarcode', () => {
  it('drops the leading 0 iOS adds when it reports a UPC-A as EAN-13', () => {
    expect(normalizeBarcode('ean13', '0012345678905')).toBe('012345678905');
    expect(normalizeBarcode('upc_a', '0012345678905')).toBe('012345678905');
  });
  it('keeps a real EAN-13, an EAN-8 and a 12-digit UPC-A as they are', () => {
    expect(normalizeBarcode('ean13', '5000112637922')).toBe('5000112637922');
    expect(normalizeBarcode('ean8', '96385074')).toBe('96385074');
    expect(normalizeBarcode('upc_a', '012345678905')).toBe('012345678905');
  });
  it('ignores anything that is not a retail barcode', () => {
    expect(normalizeBarcode('qr', 'https://example.com')).toBeNull();
    expect(normalizeBarcode('ean13', '12345')).toBeNull();
  });
});

describe('BarcodeCamera (native)', () => {
  it('limits scanning to the retail symbologies', async () => {
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={jest.fn()} />);
    expect(cameraProps.barcodeScannerSettings?.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_a']);
  });

  it('delivers one normalised UPC however many times the camera repeats it', async () => {
    const onBarcode = jest.fn();
    await render(<BarcodeCamera onBarcode={onBarcode} onError={jest.fn()} />);
    await scanTwice({ type: 'ean13', data: '0012345678905' });
    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode).toHaveBeenCalledWith('012345678905');
    expect(cameraProps.onBarcodeScanned).toBeUndefined();
    expect(cameraProps.active).toBe(false);
  });

  it('keeps looking past a code that is not a retail barcode', async () => {
    const onBarcode = jest.fn();
    await render(<BarcodeCamera onBarcode={onBarcode} onError={jest.fn()} />);
    await act(async () => cameraProps.onBarcodeScanned?.({ type: 'qr', data: 'hello' }));
    expect(onBarcode).not.toHaveBeenCalled();
    await act(async () => cameraProps.onBarcodeScanned?.({ type: 'ean8', data: '96385074' }));
    expect(onBarcode).toHaveBeenCalledWith('96385074');
  });

  it('asks for the camera when the scanner opens and shows no camera until it is granted', async () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={jest.fn()} />);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(cameraMounted).toBe(0);
  });

  it('shows what to do when the camera is refused, with Open Settings', async () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={jest.fn()} />);
    expect(screen.getByText(/Bevi needs the camera to scan a barcode/)).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(cameraMounted).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings to allow the camera' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('reports a device with no camera instead of crashing', async () => {
    mockAvailable = async () => false;
    const onError = jest.fn();
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={onError} />);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not open the camera'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports a camera that fails to mount, once', async () => {
    const onError = jest.fn();
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={onError} />);
    await act(async () => { cameraProps.onMountError?.({ message: 'no camera' }); cameraProps.onMountError?.({ message: 'no camera' }); });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('carries on when availability cannot be queried (iOS has no such call)', async () => {
    mockAvailable = async () => { throw new Error('unavailable'); };
    const onError = jest.fn();
    await render(<BarcodeCamera onBarcode={jest.fn()} onError={onError} />);
    expect(onError).not.toHaveBeenCalled();
    expect(cameraMounted).toBe(1);
  });

  it('stops the camera and ignores a late scan when it closes', async () => {
    const onBarcode = jest.fn();
    const view = await render(<BarcodeCamera onBarcode={onBarcode} onError={jest.fn()} />);
    const lateScan = cameraProps.onBarcodeScanned!;
    await view.unmount();
    expect(cameraUnmounted).toBe(1);
    await act(async () => lateScan({ type: 'ean13', data: '5000112637922' }));
    expect(onBarcode).not.toHaveBeenCalled();
  });
});
