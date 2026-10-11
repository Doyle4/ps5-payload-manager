import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, TWEMOJI_OPTIONS } from '../src/utils/markdown.js';

test('parseMarkdown converts unicode emojis to Twemoji SVGs', () => {
  const result = parseMarkdown('# PS5 BackPork 🐷');
  assert.ok(result.includes('<img class="emoji"'));
  assert.ok(result.includes('alt="🐷"'));
  assert.ok(result.includes('1f437.svg'));
  assert.ok(result.includes('<h1>PS5 BackPork'));
});

test('parseMarkdown converts GitHub shortcodes (:pig:) to Twemoji SVGs', () => {
  const result = parseMarkdown('Payload :pig: with :rocket:');
  assert.ok(result.includes('alt="🐷"'));
  assert.ok(result.includes('alt="🚀"'));
  assert.ok(result.includes('1f437.svg'));
  assert.ok(result.includes('1f680.svg'));
});

test('parseMarkdown strips markdown images to avoid broken links', () => {
  const md = '# Title\n\n![Screenshot](https://example.com/screenshot.png)\n\nSome text';
  const result = parseMarkdown(md);
  assert.ok(!result.includes('https://example.com/screenshot.png'));
  assert.ok(!result.includes('<img src="https://example.com/screenshot.png"'));
  assert.ok(result.includes('Some text'));
});

test('parseMarkdown formats headers, lists, code, and bold properly', () => {
  const md = `
## Overview
1. First item
2. Second item

- Bullet item

Here is \`code\` and **bold text**
`;
  const result = parseMarkdown(md);
  assert.ok(result.includes('<h2>Overview</h2>'));
  assert.ok(result.includes('<ol>'));
  assert.ok(result.includes('<li>First item</li>'));
  assert.ok(result.includes('<ul>'));
  assert.ok(result.includes('<li>Bullet item</li>'));
  assert.ok(result.includes('<code>code</code>'));
  assert.ok(result.includes('<strong>bold text</strong>'));
});

test('parseMarkdown handles null, undefined, and empty string safely', () => {
  assert.equal(parseMarkdown(null), '');
  assert.equal(parseMarkdown(undefined), '');
  assert.equal(parseMarkdown(''), '');
  assert.equal(parseMarkdown(123), '');
});

test('parseMarkdown handles unknown shortcodes and URLs gracefully', () => {
  const result = parseMarkdown('Check https://example.com:8080/test and :nonexistent_emoji_code:');
  assert.ok(result.includes('https://example.com:8080/test'));
  assert.ok(result.includes(':nonexistent_emoji_code:'));
});

test('polyfills provide standard Safari 11/12 runtime APIs', () => {
  assert.equal(typeof globalThis, 'object');
  assert.equal(['a', 'b', 'c'].at(-1), 'c');
  assert.equal(['a', 'b', 'c'].at(0), 'a');
  assert.equal(['a', 'b', 'c'].at(5), undefined);
  assert.equal('hello'.at(-1), 'o');
  assert.deepEqual([1, [2, [3, [4]]]].flat(Infinity), [1, 2, 3, 4]);
  assert.deepEqual([1, 2].flatMap((x) => [x, x * 2]), [1, 2, 2, 4]);
  assert.deepEqual(Object.fromEntries([['k', 'v'], ['num', 42]]), { k: 'v', num: 42 });
  assert.equal(Object.hasOwn({ foo: 1 }, 'foo'), true);
  assert.equal(Object.hasOwn({ foo: 1 }, 'bar'), false);
  assert.equal('foo bar foo'.replaceAll('foo', 'baz'), 'baz bar baz');
});

