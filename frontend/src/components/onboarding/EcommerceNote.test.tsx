import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { EcommerceNote } from './EcommerceNote';

/** The competitors step says why Product Visibility is on when setup found an online store. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('EcommerceNote', () => {
  it('names the brand, what was turned on, and where to turn it off', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <EcommerceNote brandName="Acme Coffee" />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toBe(
      'Acme Coffee looks like an online store, so we turned on Product Visibility: ChatGPT Shopping is tracked for your prompts on plans that include it. You can turn it off in brand settings.',
    );
    act(() => root.unmount());
  });
});
