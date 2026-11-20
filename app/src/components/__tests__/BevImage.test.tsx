import { render, screen } from '@testing-library/react-native';

import { BevImage } from '../BevImage';

it('labels the tile with the Bev name', async () => {
  await render(<BevImage art={{ kind: 'can' }} alt="Sprite" size={56} />);
  expect(screen.getByLabelText('Sprite')).toBeTruthy();
  expect(screen.queryByTestId('shimmer')).toBeNull();
});

it('renders a photo when it has a src', async () => {
  await render(<BevImage src="https://example.com/a.png" alt="Topo Chico" size={96} />);
  const tile = screen.getByLabelText('Topo Chico');
  expect(tile.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 96, height: 96 })]));
});

it('shimmers while processing and loading', async () => {
  await render(<BevImage art={{ kind: 'boba' }} alt="Horchata" status="processing" />);
  expect(screen.getByLabelText('Horchata (photo processing)')).toBeTruthy();
  expect(screen.getByTestId('shimmer')).toBeTruthy();
  await render(<BevImage status="loading" alt="Sprite" />);
  expect(screen.getByLabelText('Sprite, loading')).toBeTruthy();
});

it('lets an illustration tile describe its own processing state', async () => {
  await render(<BevImage alt="Horchata illustration" status="processing" processingLabel="illustration generation" size={96} />);
  expect(screen.getByLabelText('Horchata illustration (illustration generation)')).toBeTruthy();
  expect(screen.getByTestId('shimmer')).toBeTruthy();
});

describe('the wordmark set across a generated icon', () => {
  // The illustration deliberately has no lettering of its own: the image model refuses a
  // recognisable brand mark, so the type is drawn here instead (BevIcon.labelBand).
  const BAND = { x: 0.2, y: 0.3, width: 0.6, height: 0.25, dark: true };

  it('sets the wordmark inside the band on a large tile', async () => {
    await render(<BevImage src="https://example.com/icon.png" alt="Mango Sparkler" size={155} labelBand={BAND} wordmark="Acme" />);
    expect(screen.getByText('Acme')).toBeTruthy();
  });

  it('leaves it out on a tile too small to read it, rather than drawing a smudge', async () => {
    await render(<BevImage src="https://example.com/icon.png" alt="Mango Sparkler" size={40} labelBand={BAND} wordmark="Acme" />);
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('leaves it out when the band is shorter than a line of type', async () => {
    await render(
      <BevImage src="https://example.com/icon.png" alt="Mango Sparkler" size={155} labelBand={{ ...BAND, height: 0.02 }} wordmark="Acme" />,
    );
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('draws nothing without a band, a wordmark, or art to put them on', async () => {
    await render(<BevImage src="https://example.com/icon.png" alt="A" size={155} wordmark="Acme" />);
    expect(screen.queryByText('Acme')).toBeNull();
    await render(<BevImage src="https://example.com/icon.png" alt="B" size={155} labelBand={BAND} wordmark="   " />);
    expect(screen.queryByText('Acme')).toBeNull();
    await render(<BevImage art={{ kind: 'can' }} alt="C" size={155} labelBand={BAND} wordmark="Acme" />);
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('keeps the wordmark out of the tile\'s accessible name, which is the Bev', async () => {
    await render(<BevImage src="https://example.com/icon.png" alt="Mango Sparkler" size={155} labelBand={BAND} wordmark="Acme" />);
    expect(screen.getByLabelText('Mango Sparkler')).toBeTruthy();
  });
});
