import { expect, test } from 'vitest';
import { csvLine, toCsv } from './csv.js';

test('plain values pass through unquoted', () => {
  const result = toCsv([{ name: 'hello', value: 'world' }], ['name', 'value']);
  expect(result).toBe('name,value\nhello,world');
});

test('comma in a value triggers quoting', () => {
  const result = toCsv([{ name: 'a,b' }], ['name']);
  expect(result).toBe('name\n\"a,b\"');
});

test('double quote in a value is doubled and the field is quoted', () => {
  const result = toCsv([{ text: 'she said "hi"' }], ['text']);
  expect(result).toBe('text\n"she said ""hi"""');
});

test('newline in a value triggers quoting', () => {
  const result = toCsv([{ text: 'line1\nline2' }], ['text']);
  expect(result).toBe('text\n\"line1\nline2\"');
});

test('lone carriage return in a value triggers quoting', () => {
  const result = toCsv([{ text: 'line1\rline2' }], ['text']);
  expect(result).toBe('text\n\"line1\rline2\"');
});

test('CRLF in a value remains quoted', () => {
  const result = toCsv([{ text: 'line1\r\nline2' }], ['text']);
  expect(result).toBe('text\n\"line1\r\nline2\"');
});

test('null and undefined become empty strings', () => {
  const result = toCsv([{ a: null, b: undefined, c: 'value' }], ['a', 'b', 'c']);
  expect(result).toBe('a,b,c\n,,value');
});

test('header row is emitted first, joined by commas', () => {
  const result = toCsv([{ foo: 'bar' }], ['foo', 'bar', 'baz']);
  expect(result).toBe('foo,bar,baz\nbar,,');
});

test('column order follows the headers array', () => {
  const result = toCsv([{ b: '2', a: '1' }], ['a', 'b']);
  expect(result).toBe('a,b\n1,2');
});

test('missing key in a row produces an empty field', () => {
  const result = toCsv([{ a: '1' }], ['a', 'b']);
  expect(result).toBe('a,b\n1,');
});

test('multiple rows are joined by newline', () => {
  const result = toCsv(
    [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ],
    ['a', 'b'],
  );
  expect(result).toBe('a,b\n1,2\n3,4');
});

test('string values starting with formula injection triggers get prefixed with single quote', () => {
  const result = toCsv(
    [{ formula: '=1+1', plus: '+cmd', minus: '-calc', at: '@user', tab: '\ttab', cr: '\rline' }],
    ['formula', 'plus', 'minus', 'at', 'tab', 'cr'],
  );
  expect(result).toBe(
    'formula,plus,minus,at,tab,cr\n' + "'=1+1,'+cmd,'-calc,'@user,'\ttab,\"'\rline\"",
  );
});

test('string with leading formula trigger and comma is prefixed and quoted', () => {
  const result = toCsv([{ val: '=a,b' }], ['val']);
  expect(result).toBe('val\n"\'=a,b"');
});

test('negative numbers remain untouched as numeric values', () => {
  const result = toCsv([{ score: -3.2, rank: -5 }], ['score', 'rank']);
  expect(result).toBe('score,rank\n-3.2,-5');
});

test('csvLine escapes each value as a cell', () => {
  expect(csvLine(['Search', 'a, "b"', '=1+1', null])).toBe(`Search,"a, ""b""",'=1+1,`);
});
