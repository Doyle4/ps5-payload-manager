import identifiers from '../assets/emoji/identifiers.js';

// Match the longest known sequence, including flags, skin tones and ZWJ/tag
// sequences. Variation selectors don't change which Twemoji artwork is used.
const root = new Map();
const sheets = new WeakMap();
export const EMOJI_BASE_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@v15.1.0/assets/72x72/';
const CACHE_KEY = 'twemoji-v15.1.0-png';
const MAX_CACHED_IMAGES = 128;
const MAX_IMAGE_SIZE = 24000;
const isImage = value => typeof value === 'string' && value.length <= MAX_IMAGE_SIZE && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);

function artworkCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return Object.fromEntries(Object.entries(saved).filter(([key, value]) => /^[a-f0-9-]+$/.test(key) && isImage(value)).slice(-MAX_CACHED_IMAGES));
  } catch { return {}; }
}

function ensureEmojiRule(identifier) {
  if (typeof document === 'undefined') return;
  let entry = sheets.get(document);
  if (!entry) {
    const style = document.createElement('style');
    style.setAttribute('data-emoji-images', '');
    document.head.appendChild(style);
    entry = { sheet: style.sheet, seen: new Set(), cache: artworkCache() };
    sheets.set(document, entry);
  }
  if (entry.seen.has(identifier)) return;
  entry.seen.add(identifier);
  // Identifiers come exclusively from the pinned Twemoji manifest. Markdown
  // cannot supply URLs, styles, classes or cache entries to these rules.
  const index = entry.sheet.insertRule(`.markdown-body .emoji-${identifier}{}`, entry.sheet.cssRules.length);
  const rule = entry.sheet.cssRules[index];
  const show = image => {
    rule.style.backgroundImage = `url("${image}")`;
    rule.style.textIndent = '-9999px';
  };
  if (entry.cache[identifier]) { show(entry.cache[identifier]); return; }
  // force-cache reuses the CDN HTTP cache even where persistent storage is
  // unavailable. Stored data URLs also work on PS5's insecure HTTP origin.
  fetch(`${EMOJI_BASE_URL}${identifier}.png`, { cache: 'force-cache' })
    .then(response => { if (!response.ok) throw Error('Emoji unavailable'); return response.blob(); })
    .then(blob => new Promise((resolve, reject) => {
      if (blob.type !== 'image/png' || blob.size > MAX_IMAGE_SIZE * 0.75) { reject(); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }))
    .then(image => {
      if (!isImage(image)) return;
      show(image);
      entry.cache[identifier] = image;
      const keys = Object.keys(entry.cache);
      if (keys.length > MAX_CACHED_IMAGES) delete entry.cache[keys[0]];
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry.cache)); } catch { /* HTTP cache remains available */ }
    })
    .catch(() => { entry.seen.delete(identifier); }); // Retry on the next render; Unicode stays readable.
}
identifiers.forEach(identifier => {
  let branch = root;
  for (const point of identifier.split('-').filter(hex => hex !== 'fe0f')) {
    const character = String.fromCodePoint(parseInt(point, 16));
    if (!branch.has(character)) branch.set(character, new Map());
    branch = branch.get(character);
  }
  branch.set('', identifier);
});

export function emojiSegments(text) {
  const characters = Array.from(text), segments = [];
  let plain = '';
  for (let start = 0; start < characters.length;) {
    let branch = root, end = start, matchEnd = start, identifier;
    while (end < characters.length) {
      const character = characters[end];
      if (character !== '\uFE0F') {
        branch = branch.get(character);
        if (!branch) break;
      } else if (end === start) break;
      end++;
      if (branch.has('')) { identifier = branch.get(''); matchEnd = end; }
    }
    if (identifier === undefined) { plain += characters[start++]; continue; }
    if (plain) { segments.push({ text: plain }); plain = ''; }
    segments.push({ text: characters.slice(start, matchEnd).join(''), identifier });
    start = matchEnd;
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

export function replaceEmojiText(element) {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4); // SHOW_TEXT
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const segments = emojiSegments(node.nodeValue);
    if (!segments.some(segment => segment.identifier !== undefined)) continue;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (segment.identifier === undefined) fragment.appendChild(document.createTextNode(segment.text));
      else {
        ensureEmojiRule(segment.identifier);
        const span = document.createElement('span');
        span.className = `emoji emoji-${segment.identifier}`;
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', segment.text);
        // Keep copyable/accessible text; CSS hides the unsupported native glyph.
        span.textContent = segment.text;
        fragment.appendChild(span);
      }
    }
    node.parentNode.replaceChild(fragment, node);
  }
}
