/**
 * What a key in the composer's box does (CHAT-02 items 25–27, agentic
 * update): Enter sends, Shift+Enter adds a line, Enter while an input method
 * composes (IME) or on a touch screen is the box's own; while a run answers,
 * Enter steers it with the text and Esc stops it; while it waits on a
 * question (`stoppable`), Enter answers and Esc stops it. 'block' keeps Enter from
 * adding a line to a box with nothing to send. Tab in an empty box with a
 * ghost suggestion takes it in as text ('accept', items 9 and 10b); with
 * text, Tab moves on as usual.
 */
export type ComposerKeyAction = 'send' | 'steer' | 'stop' | 'accept' | 'block' | null;

export function composerKeyAction(key: {
  key: string;
  shiftKey: boolean;
  /** An input method is composing (IME): its Enter picks the word. */
  composing: boolean;
  /** A touch screen: Enter adds a line, only the button sends. */
  coarse: boolean;
  running: boolean;
  /** A run waits on a question: Esc stops it though Enter sends (CHAT-07 §A item 9). */
  stoppable?: boolean;
  /** The box has more than spaces. */
  hasText: boolean;
  /** Steering is on for this composer. */
  canSteer: boolean;
  /** A ghost suggestion shows in the empty box. */
  ghost?: boolean;
}): ComposerKeyAction {
  if (key.key === 'Escape') return key.running || key.stoppable ? 'stop' : null;
  if (key.key === 'Tab') return key.ghost && !key.hasText && !key.shiftKey ? 'accept' : null;
  if (key.key !== 'Enter' || key.shiftKey || key.composing || key.coarse) return null;
  if (!key.hasText) return 'block';
  if (key.running) return key.canSteer ? 'steer' : 'block';
  return 'send';
}
