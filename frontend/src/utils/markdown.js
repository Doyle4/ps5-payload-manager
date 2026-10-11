import '../polyfills.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import emojiMap from './emojiMap.js';

export const TWEMOJI_OPTIONS = {
  folder: 'svg',
  ext: '.svg',
  base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/',
};

// Configure marked to strip markdown image tokens (![alt](url))
const markdownRenderer = {
  image() {
    return '';
  },
};

marked.use({
  gfm: true,
  breaks: false,
  renderer: markdownRenderer,
});

function toCodePoint(unicodeSurrogates, sep = '-') {
  const r = [];
  let c = 0;
  let p = 0;
  let i = 0;
  while (i < unicodeSurrogates.length) {
    c = unicodeSurrogates.charCodeAt(i++);
    if (p) {
      r.push((0x10000 + ((p - 0xd800) << 10) + (c - 0xdc00)).toString(16));
      p = 0;
    } else if (0xd800 <= c && c <= 0xdbff) {
      p = c;
    } else {
      r.push(c.toString(16));
    }
  }
  return r.join(sep);
}

function grabTheRightIcon(rawText) {
  // If no zero-width joiner, strip variation selector-16 (FE0F)
  return toCodePoint(
    rawText.indexOf('\u200D') < 0 ? rawText.replace(/\uFE0F/g, '') : rawText
  );
}

const HTML_TAG_OR_EMOJI_REGEX = /(<[^>]+>)|((?:(?:\ud83c[\udde6-\uddff]){2}|[\u0023-\u0039]\ufe0f?\u20e3|[\ud800-\udbff][\udc00-\udfff]|[\u2600-\u27bf\u2300-\u23ff\u2b50\u2b55\u2934\u2935\u2194-\u2199\u21a9-\u21aa\u3030\u303d\u3297\u3299])(?:\ufe0f|\ud83c[\udffb-\udfff]|\u200d(?:[\ud800-\udbff][\udc00-\udfff]|[\u2600-\u27bf\u2300-\u23ff]))*)/g;

export function parseTwemoji(html, options = TWEMOJI_OPTIONS) {
  if (!html || typeof html !== 'string') return '';
  const base = options.base || '';
  const folder = options.folder ? `${options.folder}/` : (options.size ? `${options.size}/` : '');
  const ext = options.ext || '.svg';
  const className = options.className || 'emoji';

  return html.replace(HTML_TAG_OR_EMOJI_REGEX, (match, tag, emoji) => {
    if (tag) return tag;
    const icon = grabTheRightIcon(emoji);
    return `<img class="${className}" draggable="false" alt="${emoji}" src="${base}${folder}${icon}${ext}"/>`;
  });
}

export function emojify(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/:([a-zA-Z0-9_\-+]+):/g, (match, name) => emojiMap[name] || match);
}

export const twemoji = {
  parse: (text, options) => parseTwemoji(text, options || TWEMOJI_OPTIONS),
};

/**
 * Parses markdown to sanitized HTML with emojis converted to Twemoji SVGs.
 *
 * 1. Replaces GitHub emoji shortcodes (:pig: -> 🐷)
 * 2. Parses markdown to HTML without <img> elements
 * 3. Sanitizes HTML with DOMPurify forbidding media tags
 * 4. Converts Unicode emojis into Twemoji SVGs for consistent cross-platform/PS5 display
 *
 * @param {string} markdown - Raw markdown text
 * @returns {string} Sanitized HTML string
 */
export function parseMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';

  // 1. Expand emoji shortcodes
  const withEmojis = emojify(markdown);

  // 2. Parse markdown to HTML
  const rawHtml = marked.parse(withEmojis);

  // 3. Sanitize HTML
  let cleanHtml = rawHtml;
  const sanitizeFn = (DOMPurify && typeof DOMPurify.sanitize === 'function')
    ? DOMPurify.sanitize
    : (typeof window !== 'undefined' && typeof DOMPurify === 'function' ? DOMPurify(window).sanitize : null);
  if (typeof sanitizeFn === 'function') {
    cleanHtml = sanitizeFn(rawHtml, {
      FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'source', 'iframe', 'object', 'embed'],
    });
  }

  // 4. Convert Unicode emojis to Twemoji SVGs
  return parseTwemoji(cleanHtml, TWEMOJI_OPTIONS);
}
