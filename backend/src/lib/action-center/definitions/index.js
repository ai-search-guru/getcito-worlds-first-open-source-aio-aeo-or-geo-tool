/**
 * The action definition registry (#818, phase 4).
 *
 * A definition says what condition deserves an action, what work it implies,
 * and what data a brand must have for it to apply. Until now the eight of
 * them lived in one array inside the generator, with their payload shaping
 * in a switch beside it. That is fine at eight and impossible at sixty-two:
 * every new definition would mean editing the engine, and a mistake in one
 * would break the others.
 *
 * So the engine no longer knows any definition by name. Each one is a file
 * in this directory; the registry finds them, checks them, and hands the
 * engine a list. Adding a definition means adding a file — nothing in
 * generate.js, nothing in another definition.
 *
 * Discovery is by directory listing rather than a manifest of imports on
 * purpose: a manifest is one more place to forget, and forgetting it fails
 * silently (the definition simply never fires) where a malformed file fails
 * loudly, at startup, with the filename in the message.
 *
 * ## Versions
 *
 * `version` is the definition's own, bumped by whoever changes what it means
 * — different thresholds, a different task list, a different scope. Every
 * action records the version that created it, so an action raised in March
 * can still be read against the rules that raised it. Nothing reads the
 * version yet; recording it costs a column, and reconstructing it later
 * would cost the history.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCES } from '../sources.js';

const DIR = dirname(fileURLToPath(import.meta.url));

/** Mirrors the actions.category check constraint. */
export const CATEGORIES = Object.freeze(['growth', 'protect', 'recover', 'fix', 'compete']);

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const CODE_PATTERN = /^[GPRFC]\d{2}$/;
const CODE_FAMILY = { G: 'growth', P: 'protect', R: 'recover', F: 'fix', C: 'compete' };

/**
 * A plan is task ids, conditional entries, and `optimise | create` branches.
 * Anything else is a typo that would plan nothing.
 */
function assertTaskPlan(tasks, file) {
  if (!Array.isArray(tasks) || tasks.length === 0) fail(file, 'tasks must not be empty');
  for (const entry of tasks) {
    if (typeof entry === 'string') continue;
    if (entry && Array.isArray(entry.branch) && entry.branch.length === 2) {
      if (entry.branch.some((b) => !Array.isArray(b) || b.some((id) => typeof id !== 'string'))) {
        fail(file, 'a branch is two lists of task ids');
      }
      continue;
    }
    if (entry && typeof entry.id === 'string') continue;
    fail(file, 'a task entry is an id, { id, requires }, or { branch: [[…], […]] }');
  }
}

function fail(file, message) {
  throw new Error(`[action definitions] ${file}: ${message}`);
}

function assertStringList(value, { file, field, allowed, allowEmpty = false }) {
  if (!Array.isArray(value)) fail(file, `${field} must be an array`);
  if (value.length === 0 && !allowEmpty) fail(file, `${field} must not be empty`);
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail(file, `${field} contains a non-string entry`);
    }
    if (allowed && !allowed.includes(entry)) {
      fail(file, `${field} names an unknown source "${entry}"`);
    }
  }
  if (new Set(value).size !== value.length) fail(file, `${field} contains duplicates`);
}

/**
 * Everything a definition must get right to be loaded at all.
 *
 * Strict on purpose. A definition that is half-wrong is worse than one that
 * is missing: it produces actions nobody can present, or claims a signal
 * kind nothing emits and quietly never fires.
 */
function validate(definition, file) {
  if (!definition || typeof definition !== 'object') fail(file, 'must default-export an object');

  const { id, version, category, signalKinds, requires, optional, tasks, payload } = definition;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail(file, 'id must be a lower_snake_case string');
  }
  // The specification's stable code — G01, P04, R11 — alongside the stored id.
  if (typeof definition.code !== 'string' || !CODE_PATTERN.test(definition.code)) {
    fail(file, 'code must look like G01 / P01 / R01 / F01 / C01');
  }
  if (CODE_FAMILY[definition.code[0]] !== category) {
    fail(file, `code ${definition.code} does not belong to the ${category} family`);
  }
  if (typeof definition.enabled !== 'boolean') fail(file, 'enabled must be true or false');
  if (!definition.enabled && typeof definition.disabledReason !== 'string') {
    fail(file, 'a disabled definition must say why');
  }
  if (!Number.isInteger(version) || version < 1) fail(file, 'version must be a positive integer');
  if (!CATEGORIES.includes(category)) fail(file, `category "${category}" is not a known family`);

  assertStringList(signalKinds, { file, field: 'signalKinds' });
  assertTaskPlan(tasks, file);
  assertStringList(requires, { file, field: 'requires', allowed: SOURCES });
  assertStringList(optional ?? [], { file, field: 'optional', allowed: SOURCES, allowEmpty: true });

  const overlap = (optional ?? []).filter((source) => requires.includes(source));
  if (overlap.length > 0) fail(file, `${overlap.join(', ')} is both required and optional`);

  if (typeof payload !== 'function') fail(file, 'payload must be a function');

  return Object.freeze({ ...definition, optional: Object.freeze([...(optional ?? [])]) });
}

let cache = null;

/**
 * Every definition, ordered by id so a run is reproducible.
 *
 * @returns {Promise<readonly object[]>}
 */
export async function loadDefinitions() {
  if (cache) return cache;

  const files = readdirSync(DIR)
    .filter(
      (file) =>
        file.endsWith('.js') &&
        file !== 'index.js' &&
        !file.startsWith('_') &&
        !file.endsWith('.test.js'),
    )
    .sort();

  const definitions = [];
  const seen = new Set();
  for (const file of files) {
    const module = await import(pathToFileURL(join(DIR, file)).href);
    const definition = validate(module.default, file);
    if (seen.has(definition.id)) fail(file, `id "${definition.id}" is already taken`);
    seen.add(definition.id);
    definitions.push(definition);
  }

  cache = Object.freeze(definitions.sort((a, b) => a.id.localeCompare(b.id)));
  return cache;
}

/**
 * Does this brand have what the definition needs?
 *
 * Belt and braces today — a brand with no competitors never gets a
 * competitor signal, so the definition would not have matched anyway — but
 * it makes the data contract a declaration rather than a coincidence, and
 * phase 5 reads the same answer to decide which tasks a plan can contain.
 *
 * @param {{ requires: readonly string[] }} definition
 * @param {Set<string>} available
 */
export function isEligible(definition, available) {
  return (
    definition.enabled !== false && definition.requires.every((source) => available.has(source))
  );
}
