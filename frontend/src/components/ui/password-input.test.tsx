import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input } from './input';
import { PasswordInput } from './password-input';

/**
 * A password, key or token typed into a password field is left out of
 * session replays (`ph-no-capture`), also while PasswordInput shows it.
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

const input = () => container.querySelector('input')!;

describe('password fields in session replays', () => {
  it('leaves an Input of type password out, and not other inputs', () => {
    act(() => root.render(<Input type="password" className="font-mono" />));
    expect(input().classList.contains('ph-no-capture')).toBe(true);
    expect(input().classList.contains('font-mono')).toBe(true);

    act(() => root.render(<Input type="text" />));
    expect(input().classList.contains('ph-no-capture')).toBe(false);
  });

  it('leaves a PasswordInput out, also once the password is shown', () => {
    act(() => root.render(<PasswordInput />));
    expect(input().type).toBe('password');
    expect(input().classList.contains('ph-no-capture')).toBe(true);

    act(() => container.querySelector('button')!.click());
    expect(input().type).toBe('text');
    expect(input().classList.contains('ph-no-capture')).toBe(true);
  });
});
