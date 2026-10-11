import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { emojify } from 'node-emoji';
import twemoji from '@twemoji/api';

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
  const sanitizeFn = DOMPurify?.sanitize || (typeof window !== 'undefined' && typeof DOMPurify === 'function' ? DOMPurify(window).sanitize : null);
  if (typeof sanitizeFn === 'function') {
    cleanHtml = sanitizeFn(rawHtml, {
      FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'source', 'iframe', 'object', 'embed'],
    });
  }

  // 4. Convert Unicode emojis to Twemoji SVGs
  return twemoji.parse(cleanHtml, TWEMOJI_OPTIONS);
}
