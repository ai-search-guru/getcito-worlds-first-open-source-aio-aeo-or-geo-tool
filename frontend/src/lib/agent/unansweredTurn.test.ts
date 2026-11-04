import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { takeBackUnansweredTurn } from './unansweredTurn';

const user = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});
const answer = (id: string, text: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
});

describe('takeBackUnansweredTurn', () => {
  it('takes the refused message off the thread, with its text for the input', () => {
    const thread = [user('u1', 'Hi'), answer('a1', 'Hello'), user('u2', 'How is my brand doing?')];
    expect(takeBackUnansweredTurn(thread)).toEqual({
      messages: [user('u1', 'Hi'), answer('a1', 'Hello')],
      text: 'How is my brand doing?',
    });
  });

  it('drops an empty answer begun after it too', () => {
    const begun: UIMessage = { id: 'a2', role: 'assistant', parts: [] };
    expect(takeBackUnansweredTurn([user('u1', 'Hi'), begun])).toEqual({
      messages: [],
      text: 'Hi',
    });
  });

  it('leaves a thread that was answered alone', () => {
    expect(takeBackUnansweredTurn([user('u1', 'Hi'), answer('a1', 'Hello')])).toBeNull();
    expect(takeBackUnansweredTurn([])).toBeNull();
  });
});
