// The map's design-system components (M-16 part 2): MapFilterRow, MapControls, VenueRow and
// VenueSheet, plus the venue copy and the VenueSheet rows' score rule they rely on.

import { ApiError, type BevSummary, type Venue } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform, Text } from 'react-native';

import { venueBevScore } from '@/features/map/VenuePanel';
import { openLabel, venueMeta, websiteLink } from '@/lib/venue';

import { MapControls } from '../MapControls';
import { MapFilterRow } from '../MapFilterRow';
import { VenueRow } from '../VenueRow';
import { VENUE_GONE, VenueSheet } from '../VenueSheet';

const venue: Venue = {
  id: 'v',
  name: 'Yorkville Coffee Works',
  kind: 'craft',
  lat: 40.77,
  lng: -73.95,
  address: '1512 2nd Avenue',
  neighborhood: 'Yorkville',
  borough: 'Manhattan',
  hoursOsm: null,
  hoursKnown: false,
  website: 'https://www.yorkville.example/',
};

describe('venue copy', () => {
  it('open state: unknown hours are never "closed"', () => {
    expect(openLabel(true)).toBe('Open now');
    expect(openLabel(false)).toBe('Closed');
    expect(openLabel(null)).toBe('Hours unknown');
  });

  it('meta lines', () => {
    expect(venueMeta(venue)).toBe('Craft · Yorkville');
    expect(venueMeta(venue, true)).toBe('Craft · Yorkville · Manhattan');
    expect(venueMeta({ kind: 'chain', neighborhood: null, borough: null }, true)).toBe('Chain');
  });

  it('only opens http(s) websites', () => {
    expect(websiteLink('https://www.yorkville.example/')).toEqual({ href: 'https://www.yorkville.example/', label: 'yorkville.example' });
    expect(websiteLink('javascript:alert(1)')).toBeNull();
    expect(websiteLink('yorkville.example')).toBeNull();
    expect(websiteLink(null)).toBeNull();
  });
});

describe('MapFilterRow', () => {
  it('leaves Neighborhood out without a vocabulary, and names what is picked', async () => {
    const onOpenNow = jest.fn();
    const { rerender } = await render(<MapFilterRow />);
    expect(screen.getByLabelText('Neighborhood')).toBeTruthy();
    expect(screen.getByLabelText('Filters')).toBeTruthy();
    await rerender(<MapFilterRow neighborhoods={false} count={2} price="$, $$" openNow onOpenNow={onOpenNow} />);
    expect(screen.queryByLabelText(/^Neighborhood/)).toBeNull();
    expect(screen.getByLabelText('Filters, 2 on')).toBeTruthy();
    expect(screen.getByText('$, $$')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open now' }).props['aria-pressed']).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Open now' }));
    expect(onOpenNow).toHaveBeenCalled();
  });
});

describe('MapControls', () => {
  it('inline: open the full map and View List; no List | Map, close or locate', async () => {
    await render(<MapControls />);
    expect(screen.getByLabelText('Open the full map')).toBeTruthy();
    expect(screen.getByLabelText('View List')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText('Close map')).toBeNull();
    expect(screen.queryByLabelText('Show where I am')).toBeNull();
  });

  it('full screen: List | Map, close, locate; list mode drops the corner', async () => {
    const onModeChange = jest.fn();
    const { rerender } = await render(<MapControls expanded onModeChange={onModeChange} />);
    expect(screen.getByRole('radio', { name: 'Map' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'List' }));
    expect(onModeChange).toHaveBeenCalledWith('list');
    expect(screen.getByLabelText('Close map')).toBeTruthy();
    expect(screen.getByLabelText('Show where I am')).toBeTruthy();
    await rerender(<MapControls expanded mode="list" />);
    expect(screen.queryByLabelText('View List')).toBeNull();
    expect(screen.queryByLabelText('Show where I am')).toBeNull();
  });
});

describe('VenueRow', () => {
  it('reads as one button: name, meta, open state and Bevs, score', async () => {
    const onPress = jest.fn();
    await render(<VenueRow venue={venue} openNow={null} score={6.24} predicted bevs={1} onPress={onPress} />);
    const row = screen.getByRole('button', { name: 'Yorkville Coffee Works, Craft · Yorkville, Hours unknown · 1 Bev, predicted score 6.2' });
    expect(screen.getByLabelText('Predicted score 6.2')).toBeTruthy();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('VenueSheet', () => {
  it('data: the header, the rows and the credit', async () => {
    await render(
      <VenueSheet venue={venue} openNow bevCount={1} bevs={[{ id: 'b' } as BevSummary]} renderBev={() => <Text>A row</Text>} />,
    );
    expect(screen.getByRole('header', { name: 'Yorkville Coffee Works' })).toBeTruthy();
    expect(screen.getByText('Craft · Yorkville · Manhattan')).toBeTruthy();
    expect(screen.getByText('Open now')).toBeTruthy();
    expect(screen.getByText('Bevs here (1)')).toBeTruthy();
    expect(screen.getByText('A row')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Website, yorkville.example' })).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });

  it('the website: a real anchor on the web (new tab, no opener), the OS elsewhere', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { rerender } = await render(<VenueSheet venue={venue} />);
    await fireEvent.press(screen.getByRole('link', { name: 'Website, yorkville.example' }));
    expect(open).toHaveBeenCalledWith('https://www.yorkville.example/');
    expect(screen.getByRole('link').props.href).toBeUndefined();

    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      await rerender(<VenueSheet venue={{ ...venue, website: 'https://www.yorkville.example/' }} />);
      const link = screen.getByRole('link', { name: 'Website, yorkville.example' });
      expect(link.props).toMatchObject({ href: 'https://www.yorkville.example/', hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } });
      await rerender(<VenueSheet venue={{ ...venue, website: 'javascript:alert(1)' }} />);
      expect(screen.queryByRole('link')).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
      open.mockRestore();
    }
  });

  it('loading, empty, not found and failed', async () => {
    const { rerender } = await render(<VenueSheet venue={venue} bevCount={3} loading />);
    expect(screen.getByLabelText('Loading Bevs')).toBeTruthy();
    expect(screen.getByText('Bevs here (3)')).toBeTruthy();
    await rerender(<VenueSheet venue={venue} bevCount={0} />);
    expect(screen.getByText('No Bevs listed here yet')).toBeTruthy();
    await rerender(<VenueSheet notFound />);
    expect(screen.getByText(VENUE_GONE)).toBeTruthy();
    expect(screen.queryByText(/Bevs here/)).toBeNull();
    const onRetry = jest.fn();
    await rerender(<VenueSheet venue={venue} error={new ApiError('network', 'x')} onRetry={onRetry} />);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("a VenueSheet row's score", () => {
  const bev = { bayesScore: 7.4 } as BevSummary;
  it('yours, else a confident prediction, else the Bayesian score', () => {
    expect(venueBevScore(bev, { myRanking: { bucket: 'FINE', position: 0, bucketSize: 1, score: 5.5, note: null }, prediction: null })).toEqual({
      score: 5.5,
      variant: 'default',
      bucket: 'FINE',
      meta: 'Your score',
    });
    expect(venueBevScore(bev, { myRanking: null, prediction: { score: 8.1, confidence: 0.6, generatedAt: '', rankingVersion: '' } })).toEqual({
      score: 8.1,
      variant: 'predicted',
      meta: "You'd rate it",
    });
    // Below MIN_CONFIDENCE the prediction isn't shown.
    expect(venueBevScore(bev, { myRanking: null, prediction: { score: 8.1, confidence: 0.1, generatedAt: '', rankingVersion: '' } })).toEqual({
      score: 7.4,
      variant: 'default',
    });
    expect(venueBevScore(bev, undefined)).toEqual({ score: 7.4, variant: 'default' });
  });
});
