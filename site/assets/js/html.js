// Minimal HTML templating: every interpolated value is escaped unless it is already SafeHTML.
// Repository descriptions and names come from third parties, so nothing is trusted by default.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

function flatten(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(flatten).join('');
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    // Inside an attribute value (aria-pressed="${on}") a boolean means "true"/"false"; elsewhere it renders nothing.
    const attribute = typeof value === 'boolean' && /=\s*"$/.test(strings[i]);
    out += (attribute ? String(value) : flatten(value)) + strings[i + 1];
  }
  return new SafeHTML(out);
}

export const raw = (value) => new SafeHTML(String(value ?? ''));

/** Only http(s) links from metadata may become hrefs; "example.com" is read as https://example.com. */
export function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function render(element, content) {
  element.innerHTML = flatten(content);
  return element;
}
