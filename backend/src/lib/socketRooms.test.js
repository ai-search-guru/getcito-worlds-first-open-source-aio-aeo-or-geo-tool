import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Socket.IO events about a brand reach the people who may reach it, in
 * their own rooms, never every connected client (BRAND-ACCESS spec §8).
 */

const db = vi.hoisted(() => ({ brand: null, error: null, reads: [] }));
const brandReaders = vi.hoisted(() => vi.fn());

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({
          maybeSingle: async () => {
            db.reads.push({ table, columns, column, value });
            return { data: db.brand, error: db.error };
          },
        }),
      }),
    }),
  },
}));
vi.mock('./access.js', () => ({ brandReaders }));

const { emitToBrand, joinPersonRoom, personRoom } = await import('./socketRooms.js');

/** A Socket.IO server that records where each event went. */
function fakeIo() {
  const sent = [];
  return {
    sent,
    emit: vi.fn(),
    to: vi.fn((rooms) => ({ emit: (event, payload) => sent.push({ rooms, event, payload }) })),
  };
}

beforeEach(() => {
  db.brand = { organization_id: 'org-1' };
  db.error = null;
  db.reads = [];
  brandReaders.mockReset().mockResolvedValue(
    new Map([
      ['ada', new Set(['brand-1'])],
      ['bob', new Set(['brand-1'])],
    ]),
  );
});

describe('joinPersonRoom', () => {
  it('puts a signed-in socket in its person’s room and no other', () => {
    const socket = { user: { id: 'ada' }, join: vi.fn() };
    joinPersonRoom(socket);
    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith('user:ada');
    expect(personRoom('ada')).toBe('user:ada');
  });

  it('joins nothing without a person', () => {
    const socket = { join: vi.fn() };
    joinPersonRoom(socket);
    expect(socket.join).not.toHaveBeenCalled();
  });
});

describe('emitToBrand', () => {
  it('sends to the rooms of the people who may reach the brand, never to everyone', async () => {
    const io = fakeIo();
    const sentTo = await emitToBrand(io, 'brand-1', 'tracking:complete', {
      brandId: 'brand-1',
      resultCount: 40,
    });

    expect(sentTo).toBe(2);
    expect(db.reads).toEqual([
      { table: 'brands', columns: 'organization_id', column: 'id', value: 'brand-1' },
    ]);
    expect(brandReaders).toHaveBeenCalledWith('org-1', ['brand-1']);
    expect(io.sent).toEqual([
      {
        rooms: ['user:ada', 'user:bob'],
        event: 'tracking:complete',
        payload: { brandId: 'brand-1', resultCount: 40 },
      },
    ]);
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('sends nothing for a brand no one may reach', async () => {
    brandReaders.mockResolvedValue(new Map());
    const io = fakeIo();
    expect(await emitToBrand(io, 'brand-1', 'content:generated', {})).toBe(0);
    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('sends nothing, and reads no people, for a brand that is gone', async () => {
    db.brand = null;
    const io = fakeIo();
    expect(await emitToBrand(io, 'gone', 'tracking:complete', {})).toBe(0);
    expect(brandReaders).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('reads nothing without a server or a brand', async () => {
    expect(await emitToBrand(null, 'brand-1', 'tracking:complete', {})).toBe(0);
    expect(await emitToBrand(fakeIo(), '', 'tracking:complete', {})).toBe(0);
    expect(db.reads).toEqual([]);
  });

  it('throws when the brand can’t be read, sending nothing', async () => {
    db.error = { message: 'timeout' };
    const io = fakeIo();
    await expect(emitToBrand(io, 'brand-1', 'tracking:complete', {})).rejects.toThrow('timeout');
    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();
  });
});
