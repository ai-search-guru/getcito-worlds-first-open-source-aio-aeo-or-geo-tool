import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_BOT_NAMES, BOT_TYPES, botName } from './aiBotNames';

/** Every bot on the server's list (AT-010) has a name in the report (AT-011). */

const list = JSON.parse(
  readFileSync(join(__dirname, '../../../backend/src/lib/ai-bots.json'), 'utf8'),
) as { bots: { key: string; name: string; type: string }[] };

describe('AI bot names', () => {
  it('names every bot on the list as the list does, with a known type', () => {
    for (const bot of list.bots) {
      expect(AI_BOT_NAMES[bot.key]).toBe(bot.name);
      expect(BOT_TYPES).toContain(bot.type);
    }
    expect(Object.keys(AI_BOT_NAMES)).toHaveLength(list.bots.length);
    expect(botName('newbot')).toBe('newbot');
  });
});
