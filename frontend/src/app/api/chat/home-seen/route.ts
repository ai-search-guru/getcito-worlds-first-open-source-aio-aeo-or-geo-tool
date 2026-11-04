import { NextResponse } from 'next/server';
import { saveHomeSeen } from '@/lib/actions/chatPrefs';

/**
 * POST /api/chat/home-seen
 *
 * The person left Chat Home (CHAT-22 §1, chat_user_prefs.home_seen_at):
 * "Since you left" counts from now on their next visit. A route, not the
 * server action alone, so the page can send it with keepalive as it closes.
 * Answers as a value, never throws (#1777).
 */
export async function POST() {
  return NextResponse.json(await saveHomeSeen());
}
