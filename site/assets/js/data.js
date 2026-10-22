// Data access for the generated files in site/data/ (contract: docs/DATA.md).
import { addDays } from './format.js';

const BASE = new URL('../../data/', import.meta.url);
const cache = new Map();
let manifest = null;

export const PERIODS = { daily: '今日', weekly: '本周', monthly: '本月' };

export class DataError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function fetchJSON(path, fresh = false) {
  const url = new URL(path, BASE);
  if (manifest?.version && !fresh) url.searchParams.set('v', manifest.version);
  let response;
  try {
    response = await fetch(url, fresh ? { cache: 'no-cache' } : undefined);
  } catch {
    throw new DataError('网络连接失败，请检查网络后重试。');
  }
  if (!response.ok) throw new DataError(`数据文件 ${path} 加载失败（HTTP ${response.status}）。`, response.status);
  return response.json();
}

export function getJSON(path) {
  if (!cache.has(path)) {
    const pending = fetchJSON(path);
    cache.set(path, pending);
    pending.catch(() => cache.delete(path));
  }
  return cache.get(path);
}

function expandRanges(ranges) {
  const out = [];
  for (const [start, end] of ranges) {
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  }
  return out;
}

export async function loadManifest() {
  const data = await fetchJSON('index.json', true);
  data.dateList = expandRanges(data.dates);
  data.dateSet = new Set(data.dateList);
  data.staleSet = new Set(data.stale);
  data.listKeys = data.lists.flatMap((l) => l.periods.map((p) => `${l.key}:${p}`));
  manifest = data;
  return data;
}

export const getManifest = () => manifest;

export function listLabel(key) {
  const [list, period] = key.split(':');
  const spec = manifest?.lists.find((l) => l.key === list);
  const name = spec?.name ?? list;
  return spec && spec.periods.length > 1 ? `${name}·${PERIODS[period] ?? period}` : name;
}

/** FNV-1a over the lower-cased UTF-8 name; must match shard_of() in scripts/build.py. */
export function shardOf(name, count) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return (hash % count).toString(16).padStart((count - 1).toString(16).length, '0');
}

/** Case-insensitive own-property lookup (GitHub names are case-insensitive). */
export function pick(object, name) {
  if (!object) return null;
  if (Object.hasOwn(object, name)) return object[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(object)) if (key.toLowerCase() === lower) return object[key];
  return null;
}

// ------------------------------------------------------------------ catalog
export const FLAGS = { gone: 1, archived: 2, fork: 4, explained: 8, org: 16 };
let catalogPromise = null;

function decodeCatalog(data) {
  const col = Object.fromEntries(data.cols.map((name, i) => [name, i]));
  const base = data.base;
  const date = (n) => (n == null ? null : addDays(base, n));
  const items = data.rows.map((row, i) => {
    const get = (name) => row[col[name]] ?? null;
    const name = get('name');
    const flags = get('flags') || 0;
    return {
      i, name, lower: name.toLowerCase(), repo: name.split('/')[1].toLowerCase(),
      zh: get('zh') || '', lang: data.langs[get('lang')] ?? null, stars: get('stars'),
      g1: get('g1'), g7: get('g7'), g7span: get('g7s') ?? 7, g30: get('g30'),
      n: get('n') || 0, best: get('best'), first: date(get('first')), last: date(get('last')),
      seen: date(get('seen')), na: get('na') || 0, created: date(get('created')), flags,
      tags: (get('tags') || []).map((t) => data.tags[t]), streak: get('st') || 0,
      starDate: date(get('sd')) ?? data.star_date,
      gone: Boolean(flags & FLAGS.gone), explained: Boolean(flags & FLAGS.explained),
    };
  });
  return {
    items, langs: data.langs, tags: data.tags, starDate: data.star_date,
    byName: new Map(items.map((item) => [item.lower, item])),
  };
}

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = getJSON('catalog.json').then(decodeCatalog);
    catalogPromise.catch(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

let searchPromise = null;
/** Descriptions (original case, for display) and lower-cased search text, aligned with catalog rows. */
export function loadSearchText() {
  if (!searchPromise) {
    searchPromise = getJSON('search.json').then((data) => ({
      descs: data.rows.map((row) => row[0]),
      texts: data.rows.map((row) => `${row[0]} ${row[1]}`.toLowerCase()),
    }));
    searchPromise.catch(() => { searchPromise = null; });
  }
  return searchPromise;
}

const normalise = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Rank catalog items for a query. Every term must match somewhere; names weigh most,
 * then the Chinese one-liner, then descriptions/topics/explanations when the text index is loaded.
 */
export function searchItems(catalog, query, texts = null, pool = catalog.items) {
  const terms = normalise(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const item of pool) {
    let score = 0;
    for (const term of terms) {
      let s = 0;
      if (item.lower === term || item.repo === term) s = 120;
      else if (item.repo.startsWith(term)) s = 70;
      else if (item.lower.includes(term)) s = 45;
      else if (item.zh && item.zh.toLowerCase().includes(term)) s = 30;
      else if (item.tags.some((t) => t.toLowerCase().includes(term))) s = 20;
      else if (texts && texts[item.i]?.includes(term)) s = 12;
      if (!s) { score = 0; break; }
      score += s;
    }
    if (score) scored.push([score + Math.log10((item.stars || 0) + 10) + Math.min(item.n, 40) / 8, item]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map(([, item]) => item);
}

// ------------------------------------------------------------------ details
export async function loadRepo(name) {
  const shard = await getJSON(`repo/${shardOf(name, manifest.shards)}.json`);
  return pick(shard, name);
}

/** Recorded total-Stars observations as [date, value] pairs; unobserved days are absent. */
export async function loadStars(name) {
  const key = shardOf(name, manifest.shards);
  const years = manifest.stars?.years ?? [];
  const parts = await Promise.all(years.map((year) => getJSON(`stars/${year}/${key}.json`)
    .catch((error) => { if (error.status === 404) return {}; throw error; })));
  const points = [];
  for (const part of parts) {
    const entry = pick(part, name);
    if (!entry) continue;
    const [start, values] = entry;
    values.forEach((value, i) => { if (value != null) points.push([addDays(start, i), value]); });
  }
  return points.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export const loadHome = () => getJSON('home.json');
export const loadDay = (date) => getJSON(`days/${date}.json`);
export const loadInsights = () => getJSON('insights.json');
