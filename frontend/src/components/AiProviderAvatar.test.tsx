import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIProviderAvatar, type AIProviderKey } from './AiProviderAvatar';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container.firstElementChild as HTMLElement;
}

const logoOf = (avatar: HTMLElement) => avatar.querySelector<HTMLElement>('[aria-hidden="true"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AIProviderAvatar', () => {
  it.each<[AIProviderKey, string, string]>([
    ['openai', 'ChatGPT', '/platforms/chatgpt.svg'],
    ['anthropic', 'Claude', '/platforms/claude.svg'],
    ['google', 'Gemini', '/platforms/gemini.svg'],
    ['googleAio', 'Google AI Overviews', '/platforms/google.svg'],
    ['googleAiMode', 'Google AI Mode', '/platforms/gemini.svg'],
    ['perplexity', 'Perplexity', '/platforms/perplexity.svg'],
    ['copilot', 'Microsoft Copilot', '/platforms/copilot.svg'],
    ['xai', 'Grok', '/platforms/grok.svg'],
  ])('draws %s as a one-colour mask of its logo', (provider, label, file) => {
    const avatar = render(<AIProviderAvatar provider={provider} />);

    expect(avatar.getAttribute('title')).toBe(label);
    expect(avatar.getAttribute('aria-label')).toBe(label);
    expect(avatar.querySelector('img')).toBeNull();
    const logo = logoOf(avatar)!;
    expect(logo.style.maskImage).toBe(`url(${file})`);
    expect(logo.style.maskSize).toBe('contain');
    expect(logo.style.maskPosition).toBe('center');
    expect(logo.style.maskRepeat).toBe('no-repeat');
    // The mask is filled with the text colour, which follows the theme.
    expect(logo.className).toContain('bg-current');
    expect(avatar.className).toContain('text-foreground');
  });

  it('gives Google AI Mode the Gemini mark and AI Overview the Google G', () => {
    const mode = logoOf(render(<AIProviderAvatar provider="googleAiMode" />))!.style.maskImage;
    const gemini = logoOf(render(<AIProviderAvatar provider="google" />))!.style.maskImage;
    const overview = logoOf(render(<AIProviderAvatar provider="googleAio" />))!.style.maskImage;

    expect(mode).toBe(gemini);
    expect(overview).toBe('url(/platforms/google.svg)');
  });

  it('puts the logo at 60% inside a round, bordered badge by default', () => {
    const avatar = render(<AIProviderAvatar provider="openai" />);

    expect(avatar.className).toContain('rounded-full');
    expect(avatar.className).toContain('border');
    expect(avatar.className).toContain('bg-background');
    expect(avatar.className).not.toContain('bg-black');
    expect(logoOf(avatar)!.className).toContain('h-3/5 w-3/5');
  });

  it('fills the whole box with just the logo when plain', () => {
    const avatar = render(<AIProviderAvatar provider="openai" plain className="h-6 w-6" />);

    expect(avatar.className).not.toContain('rounded-full');
    expect(avatar.className).not.toContain('border');
    expect(avatar.className).toContain('h-6 w-6');
    const logo = logoOf(avatar)!;
    expect(logo.className).toContain('h-full w-full');
    expect(logo.className).not.toContain('invert');
  });

  it('lets the caller change the colour', () => {
    const avatar = render(
      <AIProviderAvatar provider="xai" plain className="text-muted-foreground" />,
    );

    expect(avatar.className.split(' ')).toContain('text-muted-foreground');
    expect(avatar.className.split(' ')).not.toContain('text-foreground');
  });

  it.each([false, true])(
    'keeps a plain letter badge for Meta AI, which has no logo (plain: %s)',
    (plain) => {
      const avatar = render(<AIProviderAvatar provider="meta" plain={plain} />);

      expect(avatar.textContent).toBe('M');
      expect(avatar.getAttribute('title')).toBe('Meta AI');
      expect(logoOf(avatar)).toBeNull();
      expect(avatar.className).toContain('rounded-full');
      expect(avatar.className).toContain('border');
      expect(avatar.className).toContain('bg-background');
      expect(avatar.className).toContain('text-foreground');
      expect(avatar.className).not.toMatch(/bg-sky|text-white/);
    },
  );
});
