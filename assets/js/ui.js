// Shared presentational pieces. Three kinds of numbers are kept visually and verbally apart:
//   total Stars (★, recorded value), growth (+N with an explicit window and source), rankings (#N on a named list).
import { html, raw } from './html.js';
import * as fmt from './format.js';
import { href } from './router.js';
import { getManifest, PERIODS } from './data.js';
import { isCompared } from './compare-store.js';

export const LANG_COLORS = {
  Python: '#3572A5', TypeScript: '#3178c6', JavaScript: '#e8c400', Go: '#00ADD8', Rust: '#dea584',
  Java: '#b07219', 'C++': '#f34b7d', C: '#6e6e6e', 'C#': '#178600', Shell: '#89e051',
  'Jupyter Notebook': '#DA5B0B', HTML: '#e34c26', CSS: '#663399', Swift: '#F05138', Kotlin: '#A97BFF',
  Ruby: '#701516', PHP: '#4F5D95', Dart: '#00B4AB', Vue: '#41b883', Zig: '#ec915c', Lua: '#000080',
  MDX: '#fcb32c', Svelte: '#ff3e00', Dockerfile: '#384d54', Nix: '#7e7eff', Elixir: '#6e4a7e',
  'Objective-C': '#438eff', Scala: '#c22d40', Haskell: '#5e5086', R: '#198CE7', Julia: '#a270ba',
  PowerShell: '#012456', Astro: '#ff5a03', 'Vim Script': '#199f4b', TeX: '#3D6117', Makefile: '#427819',
  Cuda: '#3A4E3A', Clojure: '#db5855', OCaml: '#ef7a08', Solidity: '#AA6746', 'Emacs Lisp': '#c065db',
  Markdown: '#083fa1', Batchfile: '#C1F12E', Assembly: '#6E4C13', Perl: '#0298c3', 'Objective-C++': '#6866fb',
};

export const langDot = (lang) => (lang
  ? html`<span class="lang"><i style="--c:${LANG_COLORS[lang] || '#9b9384'}"></i>${lang}</span>` : '');

export function avatar(name, size = '') {
  const owner = name.split('/')[0];
  const px = size === 'lg' ? 112 : size === 'md' ? 64 : 48;
  return html`<span class="avatar ${size}" data-i="${owner.slice(0, 1)}"><img src="https://github.com/${encodeURIComponent(owner)}.png?size=${px}" alt="" loading="lazy" decoding="async" data-avatar></span>`;
}

export function repoName(name, { link = true, withAvatar = true, size = '' } = {}) {
  const [owner, repo] = name.split('/');
  const inner = html`${withAvatar ? avatar(name, size) : ''}<span class="label"><span class="owner">${owner}</span><span class="slash">/</span>${repo}</span>`;
  return link ? html`<a class="repo-name" href="${href.repo(name)}">${inner}</a>` : html`<span class="repo-name">${inner}</span>`;
}

export const tagChip = (tag) => html`<a class="tag" href="${href.explore({ cat: tag })}">${tag}</a>`;
export const topicChip = (topic) => html`<a class="topic" href="${href.explore({ q: topic })}">${topic}</a>`;

// ------------------------------------------------------------------ numbers
export function starsMetric(value, { label = '总 Stars', date = null } = {}) {
  const title = date ? `总 Stars，${date} 记录` : '总 Stars';
  return html`<span class="metric stars" title="${title}"><span class="k">${label}</span><span class="v">${fmt.int(value)}</span></span>`;
}

/** Gain reported by GitHub Trending for its rolling period (24 h / 7 d / 30 d). */
export function trendingGain(value, period = 'daily') {
  if (value == null) return '';
  const title = `GitHub Trending 页面显示的${PERIODS[period]}新增 Stars（${{ daily: '过去 24 小时', weekly: '过去 7 天', monthly: '过去 30 天' }[period]}，采集时）`;
  return html`<span class="metric gain" title="${title}"><span class="k has-tip">Trending ${PERIODS[period]}</span><span class="v ${value ? '' : 'zero'}">${fmt.signed(value)}</span></span>`;
}

/** Growth measured from this site's own daily total-Stars observations. */
export function observedGain(pair, fallbackLabel = '近 7 天') {
  if (!pair) return '';
  const [value, span] = Array.isArray(pair) ? pair : [pair, 7];
  const label = span === 1 ? '近 1 天' : span === 7 ? fallbackLabel : `近 ${span} 天`;
  return html`<span class="metric gain" title="本站每日记录的总 Stars：${label}变化"><span class="k has-tip">${label}</span><span class="v ${value ? '' : 'zero'}">${fmt.signed(value)}</span></span>`;
}

export function rankChange(row, listKey = 'all:daily', { short = false } = {}) {
  const since = getManifest()?.since?.[listKey];
  if (row.new) {
    const scope = listKey === 'all:daily' ? `自 ${since} 有记录以来首次进入总榜` : `自 ${since} 开始记录该榜以来首次上榜`;
    return html`<span class="badge badge-new" title="${scope}">${short ? '首次' : '首次上榜'}</span>`;
  }
  if (row.back) return html`<span class="badge badge-back" title="此前上过这个榜，上一期不在榜">回榜</span>`;
  if (row.chg > 0) return html`<span class="chg up" title="较上一期上升 ${row.chg} 位">▲${row.chg}</span>`;
  if (row.chg < 0) return html`<span class="chg down" title="较上一期下降 ${-row.chg} 位">▼${-row.chg}</span>`;
  if (row.chg === 0) return html`<span class="chg flat" title="与上一期名次相同">=</span>`;
  return '';
}

export function listDays(days, streak) {
  if (!days) return '';
  const parts = [html`<span title="在该榜出现的天数（疑似未更新的日子不计）">在榜 <span class="num">${days}</span> 天</span>`];
  if (streak > 1) parts.push(html`<span class="badge badge-streak" title="按有记录的日期连续上榜；没有数据的日期跳过">连续 ${streak} 天</span>`);
  return parts;
}

/** Daily increments between consecutive observed days, as tiny bars (gaps stay empty). */
export function sparkbars(spark, { width = 104, height = 30, label = true } = {}) {
  if (!spark) return '';
  const [, values] = spark;
  const deltas = values.map((v, i) => (i && v != null && values[i - 1] != null ? v - values[i - 1] : null)).slice(1);
  const known = deltas.filter((d) => d != null);
  if (known.length < 2) return '';
  const max = Math.max(1, ...known.map((d) => Math.abs(d)));
  const slot = width / deltas.length;
  const bw = Math.max(2, slot - 2);
  const bars = deltas.map((d, i) => {
    if (d == null) return '';
    const h = Math.max(1.5, (Math.abs(d) / max) * (height - 2));
    const x = (i * slot + (slot - bw) / 2).toFixed(1);
    return d >= 0
      ? `<rect x="${x}" y="${(height - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`
      : `<rect class="neg" x="${x}" y="${height - 1.5}" width="${bw.toFixed(1)}" height="1.5"/>`;
  }).join('');
  const svg = raw(`<svg class="sparkbars" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${bars}</svg>`);
  return label ? html`<span class="spark-box" title="本站观测：最近 ${deltas.length} 天每日新增 Stars，空白表示当天没有观测">${svg}<small>每日新增 · 近 ${deltas.length} 天</small></span>` : svg;
}

export function compareButton(name, { compact = false } = {}) {
  const on = isCompared(name);
  return html`<button type="button" class="btn ${compact ? 'icon' : ''} ${on ? 'on' : ''}" data-action="compare" data-repo="${name}" aria-pressed="${on}" title="${on ? '移出对比' : '加入对比'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16M16 4v16M4 8h8M12 16h8"/></svg>${compact ? '' : on ? '已加入对比' : '加入对比'}</button>`;
}

export function notice(text, kind = '') {
  return html`<p class="notice ${kind}">${text}</p>`;
}

export function loading(lines = 6) {
  return html`<div class="fade-in" aria-busy="true" aria-label="加载中">
    <span class="skeleton" style="height:16px;width:180px;margin-bottom:16px"></span>
    <span class="skeleton" style="height:40px;width:min(520px,80%);margin-bottom:22px"></span>
    ${Array.from({ length: lines }, () => html`<span class="skeleton" style="height:64px;margin-bottom:12px"></span>`)}
  </div>`;
}

export function errorState(error, retry = true) {
  return html`<div class="state"><h2>没能加载这部分内容</h2><p>${error?.message || '发生了未知错误。'}</p>
    ${retry ? html`<button class="btn" type="button" data-action="reload">重新加载</button>` : ''}</div>`;
}

export function segmented(options, current, { action, name = '' } = {}) {
  return html`<div class="seg" role="group" aria-label="${name}">${options.map(([value, label, disabled]) => html`
    <button type="button" data-action="${action}" data-value="${value}" aria-pressed="${String(value) === String(current)}" ${disabled ? raw('disabled') : ''}>${label}</button>`)}</div>`;
}

let toast = null;
let toastTimer = 0;
/** Short status message (polite live region). */
export function say(message) {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
