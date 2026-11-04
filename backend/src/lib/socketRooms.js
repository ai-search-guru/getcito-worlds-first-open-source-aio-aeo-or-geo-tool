/**
 * Socket.IO rooms: who hears an event about a brand.
 *
 * Each connected socket joins its person's own room (`user:{id}`) and no
 * other. An event about a brand goes to the rooms of the people who may
 * reach that brand (brandReaders: the brand's organization, and with
 * Selected brands only those granted it), read when the event is sent, so
 * a change of access counts from the next event on. Never to every
 * connected client, which would hand any signed-in person other
 * organizations' brand ids and run figures (BRAND-ACCESS spec §8).
 */
import supabaseAdmin from '../config/supabase.js';
import { brandReaders } from './access.js';

/** The room of one person's sockets. */
export const personRoom = (userId) => `user:${userId}`;

/**
 * A socket that passed decodeTokenForSocket joins its person's room; one
 * without a person joins none, and so hears nothing.
 */
export function joinPersonRoom(socket) {
  const userId = socket?.user?.id;
  if (userId) socket.join(personRoom(userId));
}

/**
 * Send `event` about `brandId` to the people who may reach the brand. A
 * brand that is gone, or one no one may reach, sends nothing.
 * @param {import('socket.io').Server | null | undefined} io
 * @param {string} brandId
 * @param {string} event
 * @param {object} payload
 * @returns {Promise<number>} how many people's rooms it went to
 */
export async function emitToBrand(io, brandId, event, payload) {
  if (!io || !brandId) return 0;
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand?.organization_id) return 0;
  const readers = await brandReaders(brand.organization_id, [brandId]);
  const rooms = [...readers.keys()].map(personRoom);
  if (rooms.length === 0) return 0;
  io.to(rooms).emit(event, payload);
  return rooms.length;
}
