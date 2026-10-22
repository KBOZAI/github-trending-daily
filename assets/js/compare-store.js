// Projects picked for comparison, kept per browser (best effort: storage may be unavailable).
const KEY = 'gtd.compare.v1';
export const COMPARE_MAX = 4;
const listeners = new Set();

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.includes('/')).slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

let items = read();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((fn) => fn([...items]));
}

export const compared = () => [...items];
export const isCompared = (name) => items.some((n) => n.toLowerCase() === name.toLowerCase());

export function toggleCompared(name) {
  if (isCompared(name)) {
    items = items.filter((n) => n.toLowerCase() !== name.toLowerCase());
  } else {
    if (items.length >= COMPARE_MAX) return false;
    items = [...items, name];
  }
  write();
  return true;
}

export function setCompared(names) {
  const seen = new Set();
  items = names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, COMPARE_MAX);
  write();
}

export function onCompareChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
