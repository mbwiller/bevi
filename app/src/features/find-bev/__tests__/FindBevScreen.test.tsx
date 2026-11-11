import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapTab from '@/app/(tabs)/map/index';

import { FIND_BEV_BODY, FIND_BEV_CAPTION, FIND_BEV_LINK_LABEL, FIND_BEV_TITLE } from '../FindBevScreen';
import { BEV_MAPS_URL } from '../links';

const METRICS = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderMap = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MapTab />
    </SafeAreaProvider>,
  );

it('points at Bev Maps', () => {
  expect(BEV_MAPS_URL).toBe('https://bev-maps.vercel.app');
});

it('shows the Map header, the minimap, and the copy', async () => {
  await renderMap();
  expect(screen.getByRole('heading', { name: 'Map' })).toBeTruthy();
  expect(screen.getByLabelText('A round minimap: your position, a lit path and a destination')).toBeTruthy();
  expect(screen.getByRole('heading', { name: FIND_BEV_TITLE })).toBeTruthy();
  expect(FIND_BEV_TITLE).toBe('Find Bev');
  expect(screen.getByText('Walk to the closest open place to grab a drink.')).toBeTruthy();
  expect(FIND_BEV_BODY).toBe('Walk to the closest open place to grab a drink.');
  expect(screen.getByText('Opens Bev Maps')).toBeTruthy();
  expect(FIND_BEV_CAPTION).toBe('Opens Bev Maps');
});

it('names the link for where it goes, and keeps the visible label', async () => {
  await renderMap();
  expect(FIND_BEV_LINK_LABEL).toBe('Find Bev, opens Bev Maps in a new tab');
  const link = screen.getByRole('link', { name: FIND_BEV_LINK_LABEL });
  expect(screen.getAllByText('Find Bev').length).toBe(2);
  expect(link).toBeTruthy();
});

it('on the web, Find Bev is a real link opening Bev Maps in a new tab', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  try {
    await renderMap();
    const link = screen.getByRole('link', { name: 'Find Bev, opens Bev Maps in a new tab' });
    expect(link.props).toMatchObject({ href: BEV_MAPS_URL, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } });
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});

it('elsewhere, Find Bev hands the URL to the OS', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  try {
    await renderMap();
    const link = screen.getByRole('link', { name: 'Find Bev, opens Bev Maps in a new tab' });
    expect(link.props.href).toBeUndefined();
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledWith(BEV_MAPS_URL);
  } finally {
    open.mockRestore();
  }
});
