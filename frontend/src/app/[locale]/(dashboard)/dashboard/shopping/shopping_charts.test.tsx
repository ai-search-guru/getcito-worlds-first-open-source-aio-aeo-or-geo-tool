import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformCardRateChartView, ShoppingTrendChartView } from './shopping_charts';

/**
 * The Shopping page's charts (#1597): drawn at a fixed width, so Recharts
 * renders them in jsdom (only ResponsiveContainer measures zero there).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const days = [
  { date: '2026-10-20', ownCards: 2, totalCards: 9 },
  { date: '2026-10-21', ownCards: 3, totalCards: 11 },
];

describe('ShoppingTrendChartView', () => {
  it("draws the legend's two lines, the All cards one dashed as its series, named as given", () => {
    act(() =>
      root.render(
        <ShoppingTrendChartView
          width={600}
          data={days}
          labels={{ own: 'Tus tarjetas', all: 'Todas las tarjetas' }}
        />,
      ),
    );
    const icons = [...container.querySelectorAll('.recharts-legend-icon')];
    expect(icons).toHaveLength(2);
    expect(icons.filter((icon) => icon.getAttribute('stroke-dasharray') === '4 3')).toHaveLength(1);
    const legend = container.querySelector('.recharts-legend-wrapper')!.textContent;
    expect(legend).toContain('Tus tarjetas');
    expect(legend).toContain('Todas las tarjetas');
    expect(legend).not.toContain('All cards');
  });
});

describe('PlatformCardRateChartView', () => {
  it('draws a bar a platform', () => {
    act(() =>
      root.render(
        <PlatformCardRateChartView
          width={600}
          data={[
            { platform: 'ChatGPT', rate: 40 },
            { platform: 'Perplexity', rate: 25 },
          ]}
          label="Card rate"
        />,
      ),
    );
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });
});
