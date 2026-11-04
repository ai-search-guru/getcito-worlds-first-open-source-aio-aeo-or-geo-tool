import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoGoLiveEnabled, chatAgenticEnabled } from './flag';

/** The new Chat's switch: CHAT_AGENTIC, narrowed by CHAT_AGENTIC_ORGS. */

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chatAgenticEnabled', () => {
  it('is off when CHAT_AGENTIC is unset, so a self-hosted install sees nothing new', () => {
    vi.stubEnv('CHAT_AGENTIC', undefined);
    vi.stubEnv('CHAT_AGENTIC_ORGS', undefined);
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
    expect(chatAgenticEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'TRUE', ' true']) {
      vi.stubEnv('CHAT_AGENTIC', value);
      expect(chatAgenticEnabled(ORG_A)).toBe(false);
    }
  });

  it('is on for every organization when CHAT_AGENTIC_ORGS is unset or empty', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    for (const orgs of [undefined, '', ' , ,']) {
      vi.stubEnv('CHAT_AGENTIC_ORGS', orgs);
      expect(chatAgenticEnabled(ORG_A)).toBe(true);
      expect(chatAgenticEnabled(ORG_B)).toBe(true);
      expect(chatAgenticEnabled()).toBe(true);
    }
  });

  it('is on only for the listed organizations when CHAT_AGENTIC_ORGS is set', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv(
      'CHAT_AGENTIC_ORGS',
      ` ${ORG_A.toUpperCase()} , 44444444-4444-4444-8444-444444444444`,
    );
    expect(chatAgenticEnabled(ORG_A)).toBe(true);
    expect(chatAgenticEnabled(` ${ORG_A} `)).toBe(true);
    expect(chatAgenticEnabled(ORG_B)).toBe(false);
    expect(chatAgenticEnabled(null)).toBe(false);
    expect(chatAgenticEnabled()).toBe(false);
  });

  it("doesn't turn Chat on with CHAT_AGENTIC_ORGS alone", () => {
    vi.stubEnv('CHAT_AGENTIC', undefined);
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG_A);
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
  });

  it('reads the variables when asked, not when loaded', () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(chatAgenticEnabled(ORG_A)).toBe(false);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(chatAgenticEnabled(ORG_A)).toBe(true);
  });
});

describe('autoGoLiveEnabled (AUTONOMOUS-GO-LIVE §9)', () => {
  it('is off unless both CHAT_AGENTIC and CHAT_AUTO_GO_LIVE are on', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', undefined);
    expect(autoGoLiveEnabled(ORG_A)).toBe(false);
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    vi.stubEnv('CHAT_AUTO_GO_LIVE_ORGS', '');
    expect(autoGoLiveEnabled(ORG_A)).toBe(true);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(autoGoLiveEnabled(ORG_A)).toBe(false);
  });

  it('is on only for the listed organizations when CHAT_AUTO_GO_LIVE_ORGS is set', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    vi.stubEnv('CHAT_AUTO_GO_LIVE_ORGS', ` ${ORG_A.toUpperCase()} `);
    expect(autoGoLiveEnabled(ORG_A)).toBe(true);
    expect(autoGoLiveEnabled(ORG_B)).toBe(false);
    expect(autoGoLiveEnabled(null)).toBe(false);
  });
});
