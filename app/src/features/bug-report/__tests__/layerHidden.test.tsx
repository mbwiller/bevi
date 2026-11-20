import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { hideReporterLayer, useLayerHidden } from '../layerHidden';
import { ReportLayer } from '../ReportLayer';

// The iOS layer and the gate a screenshot goes through (jest resolves './ReportLayer' as iOS).

jest.mock('react-native-screens', () => {
  const { View } = require('react-native');
  return { FullWindowOverlay: (props: Record<string, unknown>) => <View testID="full-window-overlay" {...props} /> };
});

beforeEach(() => {
  jest.useFakeTimers();
  useLayerHidden.setState({ hidden: false });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('ReportLayer (iOS)', () => {
  it('draws its children in a full-window overlay that is not an accessibility modal', async () => {
    await render(
      <ReportLayer>
        <Text>on top</Text>
      </ReportLayer>,
    );
    const overlay = screen.getByTestId('full-window-overlay');
    expect(overlay.props.unstable_accessibilityContainerViewIsModal).toBe(false);
    expect(screen.getByText('on top')).toBeTruthy();
  });

  /** Starts hiding inside act (the layer re-renders hidden and says so), then lets the two frames pass. */
  async function hide(): Promise<() => void> {
    let hiding!: Promise<() => void>;
    await act(async () => {
      hiding = hideReporterLayer();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    return hiding;
  }

  it('hides for a screenshot, and says so only once the hidden layer has rendered', async () => {
    await render(
      <ReportLayer>
        <Text>on top</Text>
      </ReportLayer>,
    );
    let resolved = false;
    let hiding!: Promise<() => void>;
    await act(async () => {
      hiding = hideReporterLayer();
      void hiding.then(() => (resolved = true));
    });
    // The layer has rendered hidden, but the two frames have not passed: the shutter must wait.
    expect(useLayerHidden.getState().hidden).toBe(true);
    expect(resolved).toBe(false);
    const root = screen.getByTestId('full-window-overlay').children[0] as unknown as { props: { style: unknown; pointerEvents: string } };
    expect(JSON.stringify(root.props.style)).toContain('"opacity":0');
    expect(root.props.pointerEvents).toBe('none');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    const show = await hiding;
    expect(resolved).toBe(true);

    await act(async () => show());
    expect(useLayerHidden.getState().hidden).toBe(false);
  });

  it('resolves at once, hiding nothing, when no layer is mounted', async () => {
    const show = await hideReporterLayer();
    expect(useLayerHidden.getState().hidden).toBe(false);
    show();
  });

  it('shows the layer again by itself if the capture never gives it back', async () => {
    await render(
      <ReportLayer>
        <Text>on top</Text>
      </ReportLayer>,
    );
    await hide();
    expect(useLayerHidden.getState().hidden).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(useLayerHidden.getState().hidden).toBe(false);
  });

  it('two overlapping captures keep it hidden until both are done', async () => {
    await render(
      <ReportLayer>
        <Text>on top</Text>
      </ReportLayer>,
    );
    let first!: Promise<() => void>;
    let second!: Promise<() => void>;
    await act(async () => {
      first = hideReporterLayer();
      second = hideReporterLayer();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    const [showFirst, showSecond] = await Promise.all([first, second]);
    await act(async () => showFirst());
    expect(useLayerHidden.getState().hidden).toBe(true);
    await act(async () => showSecond());
    expect(useLayerHidden.getState().hidden).toBe(false);
  });
});
