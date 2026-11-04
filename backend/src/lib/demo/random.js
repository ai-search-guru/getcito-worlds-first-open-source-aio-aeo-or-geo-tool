import { createHash } from 'node:crypto';

/**
 * Determinism for the demo brand: the same sample every time it is built, so
 * every organization sees the same demo and a test can pin its shape. Only
 * the dates move, counted back from the moment it is built.
 */

/** A 32-bit seed from any string. */
export function seedOf(text) {
  const digest = createHash('sha256').update(String(text)).digest();
  return digest.readUInt32LE(0);
}

/**
 * A seeded generator (mulberry32): `next()` in [0, 1), and the few helpers
 * the generator needs on top of it.
 *
 * @param {string} seed
 */
export function seededRandom(seed) {
  let state = seedOf(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** True with probability `p`. */
    chance: (p) => next() < p,
    /** An integer in [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** One element of a non-empty list. */
    pick: (list) => list[Math.floor(next() * list.length)],
    /** A copy of the list in a seeded order. */
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/**
 * A stable id for one demo row: a UUID derived from the demo brand's id and
 * the row's own key (`prompt:3`, `result:2:5:perplexity-web`). A rebuild
 * writes the same ids again, so a link to a prompt or an answer of the demo
 * survives it; two organizations' demos never share one.
 *
 * @param {string} brandId
 * @param {string} key
 */
export function demoId(brandId, key) {
  const hex = createHash('sha256').update(`demo:${brandId}:${key}`).digest('hex');
  // Version 4 and RFC 4122 variant bits, so it reads as any generated uuid.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
