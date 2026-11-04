/**
 * Chat's agents' minute, once (W2-16): asks the web app to fire the
 * Schedule triggers that are due and to sweep, then to run Chat's scheduled
 * jobs that are due (CHAT-12, W3-01), as the server's cron does every
 * minute. For development, where the server's crons don't run
 * (NODE_ENV=development), and for trying a schedule by hand.
 *
 * Run from backend/, with CHAT_AGENTIC=true, CHAT_INTERNAL_SECRET (the web's
 * same value) and PUBLIC_APP_URL (default http://localhost:3000) in .env,
 * and the web app running:
 *   node src/scripts/chatAgentsTick.js
 *
 * Prints what the tick did; never prints the secret.
 */
import 'dotenv/config';
import { tickChatAgents, tickChatSchedules } from '../lib/chatAgents.js';

const agents = await tickChatAgents();
if (!agents) {
  console.log(
    'Nothing sent: set CHAT_AGENTIC=true and CHAT_INTERNAL_SECRET, and start the web app.',
  );
  process.exit(1);
}
console.log('agents', agents.status, JSON.stringify(agents.body, null, 2));
const schedules = await tickChatSchedules();
console.log('schedules', schedules?.status, JSON.stringify(schedules?.body ?? null, null, 2));
process.exit(agents.status === 200 && schedules?.status === 200 ? 0 : 1);
