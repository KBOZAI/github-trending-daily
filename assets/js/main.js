// App shell: routing, header search, compare tray and global actions.
import { loadManifest, loadCatalog, loadSearchText, searchItems } from './data.js';
import { parseHash, href } from './router.js';
import { html, render } from './html.js';
import { disposeCharts } from './charts.js';
import * as fmt from './format.js';
import { compared, toggleCompared, onCompareChange, COMPARE_MAX } from './compare-store.js';
import { avatar, errorState, loading, say } from './ui.js';

const VIEWS = {
  home: () => import('./views/home.js'),
  day: () => import('./views/day.js'),
  repo: () => import('./views/repo.js'),
  explore: () => import('./views/explore.js'),
  insights: () => import('./views/insights.js'),
  compare: () => import('./views/compare.js'),
  about: () => import('./views/about.js'),
  notfound: () => import('./views/notfound.js'),
};

const main = document.getElementById('main');
let token = 0;
let cleanup = null;
let currentView = '';
let linkNavigation = false;
let lastHash = location.hash;
const scrollMemory = new Map();

function setNav(view) {
  const section = view === 'repo' || view === 'compare' ? '' : view === 'notfound' ? '' : view;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route({ restoreScroll = false } = {}) {
  const current = parseHash();
  if (current.redirect) {
    history.replaceState(null, '', current.redirect);
    return route({ restoreScroll });
  }
  const mine = ++token;
  const sameView = current.view === currentView;
  currentView = current.view;
  setNav(current.view);
  cleanup?.();
  cleanup = null;
  disposeCharts();
  closeSearch();
  const ctx = { isCurrent: () => mine === token };
  try {
    const module = await VIEWS[current.view]();
    if (!ctx.isCurrent()) return;
    if (!sameView) render(main, loading());
    const result = await module.render(main, current, ctx);
    if (!ctx.isCurrent()) return;
    if (typeof result === 'function') cleanup = result;
  } catch (error) {
    if (!ctx.isCurrent()) return;
    console.error(error);
    document.title = '加载失败 · GitHub 热榜日报';
    render(main, errorState(error));
  }
  const saved = scrollMemory.get(location.hash);
  if (restoreScroll && saved != null) window.scrollTo(0, saved);
  else if (!sameView || linkNavigation) window.scrollTo(0, 0);
  linkNavigation = false;
}

// ------------------------------------------------------------------ search
const search = document.getElementById('global-search');
const input = document.getElementById('search-input');
const results = document.getElementById('search-results');
let selected = -1;
let searchTimer = 0;
let searchSerial = 0;

function openSearch() {
  search.classList.add('open');
  input.focus();
  loadCatalog().catch(() => {});
  loadSearchText().catch(() => {});
}

function closeSearch() {
  search.classList.remove('open');
  results.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  selected = -1;
}

function highlight(index) {
  const options = [...results.querySelectorAll('[role="option"]')];
  selected = options.length ? (index + options.length) % options.length : -1;
  options.forEach((o, i) => o.setAttribute('aria-selected', String(i === selected)));
  options[selected]?.scrollIntoView({ block: 'nearest' });
}

async function runSearch() {
  const query = input.value.trim();
  const serial = ++searchSerial;
  if (!query) {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    render(results, html`<p class="sr-empty">${error.message}</p>`);
    results.hidden = false;
    return;
  }
  let texts = null;
  try { texts = (await Promise.race([loadSearchText(), new Promise((r) => setTimeout(r, 400))]))?.texts ?? null; } catch { /* names still work */ }
  if (serial !== searchSerial) return;
  const found = searchItems(catalog, query, texts);
  render(results, found.length ? html`
    ${found.slice(0, 8).map((item) => html`<a role="option" href="${href.repo(item.name)}" aria-selected="false">
      ${avatar(item.name)}<span class="sr-name">${item.name}</span><span class="sr-stars num">★ ${fmt.compact(item.stars)}</span>
      <span class="sr-zh">${item.zh || (item.tags.length ? item.tags.join(' · ') : item.lang || '')}</span></a>`)}
    <a class="sr-all" href="${href.explore({ q: query })}">在项目库查看全部 ${found.length} 个结果</a>`
    : html`<p class="sr-empty">没有找到“${query}”。可以换个关键词，或<a href="${href.explore({ q: query })}">在项目库中搜索</a>。</p>`);
  results.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  selected = -1;
}

input.addEventListener('focus', () => {
  loadCatalog().catch(() => {});
  loadSearchText().catch(() => {});
  if (input.value.trim()) runSearch();
});
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 110);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight(selected + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(selected - 1); }
  else if (e.key === 'Escape') { input.blur(); closeSearch(); }
});
search.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const options = results.querySelectorAll('[role="option"]');
  const target = selected >= 0 ? options[selected]?.getAttribute('href') : href.explore({ q: input.value.trim() });
  linkNavigation = true;
  input.blur();
  closeSearch();
  location.hash = target;
});
document.addEventListener('pointerdown', (e) => {
  if (!search.contains(e.target)) { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
});

// ------------------------------------------------------------- compare tray
const tray = document.getElementById('compare-tray');
function renderTray(names = compared()) {
  const show = names.length && currentView !== 'compare';
  document.body.classList.toggle('has-tray', Boolean(show));
  if (!show) {
    tray.hidden = true;
    return;
  }
  render(tray, html`<span>对比 <b class="num">${names.length}</b>/${COMPARE_MAX}</span>
    <span class="names">${names.map((n) => n.split('/')[1]).join('、')}</span>
    <a class="go" href="${href.compare(names)}">开始对比</a>
    <button type="button" data-action="clear-compare" aria-label="清空对比">✕</button>`);
  tray.hidden = false;
}
onCompareChange((names) => {
  renderTray(names);
  document.querySelectorAll('[data-action="compare"]').forEach((button) => {
    const on = names.some((n) => n.toLowerCase() === button.dataset.repo.toLowerCase());
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? '移出对比' : '加入对比';
    const label = [...button.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    if (label) label.textContent = on ? '已加入对比' : '加入对比';
  });
});

// ----------------------------------------------------------- global events
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey) linkNavigation = true;
  const action = e.target.closest('[data-action]');
  if (!action) return;
  switch (action.dataset.action) {
    case 'compare': {
      e.preventDefault();
      const name = action.dataset.repo;
      const before = compared().length;
      if (!toggleCompared(name)) say(`最多同时对比 ${COMPARE_MAX} 个项目，请先移除一个。`);
      else if (compared().length > before) say(`已加入对比：${name}`);
      break;
    }
    case 'clear-compare':
      compared().forEach((n) => toggleCompared(n));
      break;
    case 'reload':
      window.location.reload();
      break;
    case 'back':
      if (internalSteps > 0) {
        e.preventDefault();
        history.back();
      }
      break;
    case 'open-search':
      openSearch();
      break;
    case 'close-search':
      input.value = '';
      closeSearch();
      break;
    default:
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  openSearch();
});

// Broken avatars fall back to the owner's initial.
document.addEventListener('error', (e) => {
  if (e.target.matches?.('img[data-avatar]')) e.target.classList.add('broken');
}, true);

let internalSteps = 0;
window.addEventListener('hashchange', () => {
  internalSteps += 1;
  scrollMemory.set(lastHash, window.scrollY);
  lastHash = location.hash;
  route({ restoreScroll: !linkNavigation }).then(() => renderTray());
});

// ------------------------------------------------------------------- boot
function footer(manifest) {
  render(document.getElementById('site-footer'), html`<div class="foot">
    <span>最新榜单 ${manifest.latest}（UTC 日期）· 页面数据生成于 ${fmt.beijing(manifest.generated)}（北京时间）</span>
    <span>来源：<a href="https://github.com/trending" target="_blank" rel="noopener">GitHub Trending</a> · GitHub API ·
      <a href="${manifest.backfill?.source || '#'}" target="_blank" rel="noopener">历史排名归档</a> ·
      <a href="https://github.com/KBOZAI/github-trending-daily" target="_blank" rel="noopener">源码与原始数据</a></span></div>`);
}

(async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  render(main, loading());
  try {
    footer(await loadManifest());
  } catch (error) {
    render(main, errorState(error));
    return;
  }
  await route();
  renderTray();
  // Warm the library data while the visitor reads the front page.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => loadCatalog().catch(() => {}));
}());

