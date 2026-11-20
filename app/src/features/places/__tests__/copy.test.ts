import { backfillLine, bevCount, distanceLabel, pinSubtitle, placeDetail, placeSubtitle, searchMoreLabel, shortPlaceName } from '../copy';

describe('distanceLabel', () => {
  it('reads in feet to the nearest 50 under a tenth of a mile, never "0 ft"', () => {
    expect(distanceLabel(0)).toBe('50 ft');
    expect(distanceLabel(11)).toBe('50 ft');
    expect(distanceLabel(46)).toBe('150 ft');
    expect(distanceLabel(150)).toBe('500 ft');
  });

  it('reads in miles from there: one decimal, whole from ten', () => {
    expect(distanceLabel(161)).toBe('0.1 mi');
    expect(distanceLabel(500)).toBe('0.3 mi');
    expect(distanceLabel(1609.344)).toBe('1.0 mi');
    expect(distanceLabel(20_000)).toBe('12 mi');
    expect(distanceLabel(5_000_000)).toBe('3107 mi');
  });

  it('is null with no distance, so the line simply leaves it out', () => {
    expect(distanceLabel(null)).toBeNull();
    expect(distanceLabel(undefined)).toBeNull();
    expect(distanceLabel(Number.NaN)).toBeNull();
    expect(distanceLabel(-5)).toBeNull();
  });
});

describe('placeDetail and placeSubtitle', () => {
  const venue = { address: '425 Main Street', neighborhood: 'Roosevelt Island', borough: 'Manhattan' as const };

  it('prefers the address, then the neighbourhood, then the borough', () => {
    expect(placeDetail(venue)).toBe('425 Main Street');
    expect(placeDetail({ ...venue, address: null })).toBe('Roosevelt Island');
    expect(placeDetail({ address: null, neighborhood: null, borough: 'Queens' })).toBe('Queens');
    expect(placeDetail({ address: null, neighborhood: null, borough: null })).toBeNull();
  });

  it('joins what there is of the detail and the distance', () => {
    expect(placeSubtitle(venue, 46)).toBe('425 Main Street · 150 ft');
    expect(placeSubtitle(venue)).toBe('425 Main Street');
    expect(placeSubtitle({ address: null, neighborhood: null, borough: null }, 500)).toBe('0.3 mi');
    expect(placeSubtitle({ address: null, neighborhood: null, borough: null })).toBe('');
  });
});

describe('the Map tab copy', () => {
  it('backfillLine counts the Bevs with no place, and is null when there are none to add', () => {
    expect(backfillLine({ rankedCount: 40, locatedCount: 28 })).toBe('12 of your Bevs have no location yet.');
    expect(backfillLine({ rankedCount: 3, locatedCount: 2 })).toBe('1 of your Bevs has no location yet.');
    expect(backfillLine({ rankedCount: 3, locatedCount: 3 })).toBeNull();
    expect(backfillLine({ rankedCount: 0, locatedCount: 0 })).toBeNull();
    expect(backfillLine(undefined)).toBeNull();
  });

  it('pinSubtitle says how many Bevs, how many are yours when shared, and where', () => {
    const venue = { address: '425 Main Street', neighborhood: null, borough: null };
    expect(pinSubtitle({ bevCount: 3, mineCount: 1, venue })).toBe('3 Bevs · 1 yours · 425 Main Street');
    expect(pinSubtitle({ bevCount: 1, mineCount: 1, venue })).toBe('1 Bev · 425 Main Street');
    expect(pinSubtitle({ bevCount: 2, mineCount: 0, venue: { address: null, neighborhood: null, borough: null } })).toBe('2 Bevs');
  });

  it('bevCount, shortPlaceName and searchMoreLabel', () => {
    expect(bevCount(1)).toBe('1 Bev');
    expect(bevCount(0)).toBe('0 Bevs');
    expect(shortPlaceName('Duane Reade')).toBe('Duane Reade');
    expect(shortPlaceName('The Café at Cornell Tech')).toBe('The Café at Corne…');
    expect(searchMoreLabel('bread')).toBe('Search more places for “bread”');
  });
});
