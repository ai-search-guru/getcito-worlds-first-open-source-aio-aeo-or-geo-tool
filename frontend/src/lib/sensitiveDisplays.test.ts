// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every place that shows a secret does it inside an element with the
 * `ph-no-capture` class. These defensive markers remain on sensitive
 * displays even though this app no longer includes a session recorder.
 * A new place that shows a key, token, secret or invitation link is named below.
 *
 * Password fields aren't named: Input and PasswordInput add the class
 * themselves (password-input.test.tsx). A plain <input type="password">
 * anywhere else carries it too.
 */

const SRC = join(__dirname, '..');

/** file (under src/) → what it shows, as written between `{…}`, and why it is secret. */
const SECRET_DISPLAYS: { file: string; shows: string; why: string }[] = [
  {
    file: 'components/settings/ApiKeysSection.tsx',
    shows: 'revealedToken',
    why: 'a new MCP / API key, shown once',
  },
  {
    file: 'components/settings/ApiKeysSection.tsx',
    shows: 'mcpClientSnippet(client, mcpEndpoint, revealedToken)',
    why: 'the MCP client setup, with the new key in it',
  },
  {
    file: 'app/[locale]/(dashboard)/dashboard/traffic/_BotsConnect.tsx',
    shows: 'value',
    why: "an AI-bot connection's secret, or settings with it, shown once",
  },
  {
    file: 'components/settings/TeamSection.tsx',
    shows: 'inviteLink',
    why: 'an invitation link: its token opens the invitation',
  },
];

const squash = (text: string) => text.replace(/\s+/g, ' ').replace(/\(\s/g, '(').trim();

function parse(file: string): ts.SourceFile {
  const path = join(SRC, file);
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function attributesOf(node: ts.Node): ts.JsxAttributes | null {
  if (ts.isJsxElement(node)) return node.openingElement.attributes;
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) return node.attributes;
  return null;
}

function hasNoCapture(node: ts.Node): boolean {
  const attributes = attributesOf(node);
  return Boolean(
    attributes?.properties.some(
      (a) =>
        ts.isJsxAttribute(a) &&
        a.name.getText() === 'className' &&
        a.initializer?.getText().includes('ph-no-capture'),
    ),
  );
}

/** Where the file renders `{shows}`: as a child, or as an attribute's value. */
function renders(source: ts.SourceFile, shows: string): ts.JsxExpression[] {
  const found: ts.JsxExpression[] = [];
  walk(source, (node) => {
    if (!ts.isJsxExpression(node) || !node.expression) return;
    if (squash(node.expression.getText()) !== squash(shows)) return;
    if (ts.isJsxElement(node.parent) || ts.isJsxAttribute(node.parent)) found.push(node);
  });
  return found;
}

function insideNoCapture(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (hasNoCapture(at)) return true;
  }
  return false;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('secrets are left out of session replays', () => {
  it.each(SECRET_DISPLAYS)('$file shows $shows inside ph-no-capture ($why)', ({ file, shows }) => {
    const places = renders(parse(file), shows);
    expect(places.length, `${file} no longer renders {${shows}}: update this list`).toBeGreaterThan(
      0,
    );
    for (const place of places) {
      expect(insideNoCapture(place), `${file}: {${shows}} outside ph-no-capture`).toBe(true);
    }
  });

  it('gives every plain <input type="password"> the class', () => {
    const missing: string[] = [];
    for (const path of tsxFiles(SRC)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      walk(source, (node) => {
        if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
        if (node.tagName.getText() !== 'input') return;
        const type = node.attributes.properties.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText() === 'type',
        );
        if (type?.getText().includes('password') && !hasNoCapture(node)) {
          missing.push(relative(SRC, path));
        }
      });
    }
    expect(missing).toEqual([]);
  });
});
