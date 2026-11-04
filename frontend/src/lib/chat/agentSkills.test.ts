import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { GETCITO_SKILLS, requiredBy, skillConnections, skillOf } from './agentSkills';
import { SKILL_LIBRARY, SKILL_ORDER } from './skills/library';

/**
 * The skills an agent is made of (CHAT-21 §D step 1): every skill in Chat's
 * library, the fourteen then the focus areas' seven (W2-23b), in its order,
 * each titled as its SKILL.md, with the connections it uses.
 */

const FOCUS_SKILLS = [
  'questions',
  'features',
  'gaps',
  'markets',
  'listings',
  'rivals',
  'audit-fix',
];

describe('GETCITO_SKILLS', () => {
  it("lists every library skill, in the library's order, the focus areas' seven last", () => {
    expect(GETCITO_SKILLS.map((skill) => skill.id)).toEqual([...SKILL_ORDER]);
    expect(GETCITO_SKILLS.slice(-7).map((skill) => skill.id)).toEqual(FOCUS_SKILLS);
  });

  it('titles each skill as its SKILL.md does', () => {
    const titles = messages.chatAgents.skills as Record<string, string>;
    for (const skill of SKILL_LIBRARY) {
      expect(titles[skill.name], skill.name).toBe(skill.title);
    }
    expect(Object.keys(titles).sort()).toEqual(GETCITO_SKILLS.map((skill) => skill.id).sort());
  });

  it("gives the focus areas' seven no connection: they read GetCito's own data", () => {
    for (const id of FOCUS_SKILLS) expect(skillOf(id)?.uses, id).toEqual([]);
    expect(skillConnections(FOCUS_SKILLS)).toEqual([]);
    expect(requiredBy(FOCUS_SKILLS, 'catalog')).toBeNull();
  });

  it('adds what a follow-on skill needs, Required by the one that sends the page', () => {
    expect(skillConnections(['audit-fix', 'publish'])).toEqual([
      { key: 'cms', skill: 'publish', required: true },
    ]);
    expect(skillConnections(['questions', 'report'])).toEqual([
      { key: 'google_search_console', skill: 'report', required: false },
    ]);
    expect(requiredBy(['listings', 'shopping'], 'catalog')).toBe('shopping');
  });
});
