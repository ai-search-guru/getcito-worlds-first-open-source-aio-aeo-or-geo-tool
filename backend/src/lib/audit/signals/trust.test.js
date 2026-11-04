import { describe, expect, it } from 'vitest';
import { aiBotAccess } from './trust.js';

/**
 * The AI bot access check names the bots robots.txt blocks, so the Action
 * Center can say which crawlers a block affects (AC-001). Any explicit block
 * fails the check; robots.txt is read group by group, so a bot it allows is
 * no longer failed for the rules of the group after it.
 */
describe('aiBotAccess', () => {
  it('names each AI bot robots.txt disallows, and fails on any', () => {
    const robotsTxt = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'User-agent: PerplexityBot',
      'Disallow: /',
    ].join('\n');
    expect(aiBotAccess.evaluate({ robotsTxt })).toEqual({
      status: 'fail',
      score: 0,
      evidence: {
        aiBotsMentioned: ['gptbot', 'claudebot', 'perplexitybot'],
        blocked: true,
        blockedBots: ['gptbot', 'perplexitybot'],
      },
    });
  });

  it("doesn't take the next group's rule for an allowed bot's", () => {
    const robotsTxt = 'User-agent: ClaudeBot\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /';
    expect(aiBotAccess.evaluate({ robotsTxt }).evidence.blockedBots).toEqual(['gptbot']);
    // A group naming several agents blocks each tracked AI bot among them.
    expect(
      aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: / # all',
      }).evidence.blockedBots,
    ).toEqual(['gptbot']);
  });

  it('passes a bot robots.txt allows, though everyone else is blocked', () => {
    // The old reading took the "*" group's rule for ClaudeBot's and failed.
    expect(
      aiBotAccess.evaluate({
        robotsTxt: 'User-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nDisallow: /',
      }),
    ).toMatchObject({ status: 'pass', evidence: { blocked: false, blockedBots: [] } });
  });

  it('reads agents as crawlers match them, and lets "Allow: /" win', () => {
    // A version after the name still names the bot.
    expect(
      aiBotAccess.evaluate({ robotsTxt: 'User-agent: GPTBot/1.1\nDisallow: /' }).evidence
        .blockedBots,
    ).toEqual(['gptbot']);
    // A bot's groups count together, and allowing the whole site wins a tie.
    expect(
      aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /',
      }).status,
    ).toBe('pass');
  });

  it('passes with no bot blocked, and warns without robots.txt', () => {
    expect(aiBotAccess.evaluate({ robotsTxt: 'User-agent: GPTBot\nAllow: /' })).toMatchObject({
      status: 'pass',
      evidence: { blocked: false, blockedBots: [] },
    });
    expect(aiBotAccess.evaluate({ robotsTxt: null }).status).toBe('warn');
  });
});
