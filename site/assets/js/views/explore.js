// 项目库: every project that has appeared on a tracked list, searchable and filterable.
import { html, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadCatalog, loadSearchText, searchItems } from '../data.js';
import { listRow } from './cards.js';

const SORTS = [
  ['relevance', '最相关'], ['g7', '近 7 天涨星'], ['stars', '总 Stars'], ['days', '总榜上榜天数'],
  ['recent', '最近上榜'], ['first', '首次上总榜（新→旧）'], ['created', '仓库创建（新→旧）'],
];
const SEEN = [['', '不限'], ['1', '今天在榜'], ['7', '近 7 天'], ['30', '近 30 天'], ['90', '近 90 天'], ['365', '近 1 年']];
const CREATED = [['', '不限'], ['30', '30 天内'], ['90', '90 天内'], ['365', '1 年内']];
const PAGE = 30;

const desc = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? 1 : a > b ? -1 : 0);
const COMPARE = {
  g7: (a, b) => desc(a.g7, b.g7) || desc(a.stars, b.stars),
  stars: (a, b) => desc(a.stars, b.stars),
  days: (a, b) => desc(a.n || null, b.n || null) || (a.best ?? 99) - (b.best ?? 99),
  recent: (a, b) => desc(a.seen, b.seen) || desc(a.g7, b.g7),
  first: (a, b) => desc(a.first, b.first) || (a.best ?? 99) - (b.best ?? 99),
  created: (a, b) => desc(a.created, b.created) || desc(a.stars, b.stars),
};

function readState(query) {
  const sort = query.get('sort');
  return {
    q: query.get('q') || '', cat: query.get('cat') || '', lang: query.get('lang') || '',
    seen: query.get('seen') || '', created: query.get('created') || '', explained: query.get('explained') === '1',
    sort: SORTS.some(([s]) => s === sort) ? sort : '',
  };
}

export async function render(root, route, ctx) {
  const m = getManifest();
  const latest = m.latest;
  const catalog = await loadCatalog();
  if (!ctx.isCurrent()) return;
  document.title = '项目库 · GitHub 热榜日报';
  const state = readState(route.query);
  let limit = PAGE;
  let search = null;
  loadSearchText().then((value) => {
    search = value;
    if (ctx.isCurrent()) update(false);
  }).catch(() => {});

  const langCounts = new Map();
  catalog.items.forEach((i) => { if (i.lang) langCounts.set(i.lang, (langCounts.get(i.lang) || 0) + 1); });
  const langs = [...langCounts].sort((a, b) => b[1] - a[1]).slice(0, 24);

  paint(root, html`<div class="view-explore fade-in">
    <header>
      <p class="eyebrow"><span>收录 ${m.first} 以来上过榜的项目</span></p>
      <h1 class="page-title">项目库</h1>
      <p class="lede">共 <b>${fmt.int(catalog.items.length)}</b> 个项目，其中 <b>${fmt.int(m.counts.explained)}</b> 个有中文解读。可以按用途、分类、语言和上榜时间找项目，再进入档案看它的 Stars 与上榜历史。</p>
    </header>
    <form class="search-hero" role="search" id="explore-form">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input id="explore-q" type="search" value="${state.q}" placeholder="试试：简历、向量数据库、mcp、rust cli" aria-label="搜索项目库" enterkeyhint="search" autocomplete="off">
    </form>
    <div class="filters">
      <div class="filter-line"><span class="k">分类</span><div class="chip-row" id="cat-chips" role="group" aria-label="按分类筛选"></div></div>
      <div class="filter-selects">
        <select class="select" id="f-lang" aria-label="编程语言"><option value="">全部语言</option>${langs.map(([l, n]) => html`<option value="${l}" ${l === state.lang ? 'selected' : ''}>${l}（${n}）</option>`)}</select>
        <select class="select" id="f-seen" aria-label="上榜时间">${SEEN.map(([v, l]) => html`<option value="${v}" ${v === state.seen ? 'selected' : ''}>${v ? `上榜：${l}` : '上榜时间不限'}</option>`)}</select>
        <select class="select" id="f-created" aria-label="仓库创建时间">${CREATED.map(([v, l]) => html`<option value="${v}" ${v === state.created ? 'selected' : ''}>${v ? `创建于 ${l}` : '创建时间不限'}</option>`)}</select>
        <label class="toggle"><input type="checkbox" id="f-explained" ${state.explained ? 'checked' : ''}>只看有中文解读</label>
      </div>
    </div>
    <div class="toolbar"><div class="left" id="result-count" aria-live="polite"></div>
      <label>排序 <select class="select" id="f-sort" aria-label="排序方式"></select></label></div>
    <div id="results"></div>
  </div>`);

  const $ = (id) => root.querySelector(`#${id}`);

  function filtered(skipCategory = false) {
    let pool = catalog.items;
    if (state.cat && !skipCategory) pool = pool.filter((i) => i.tags.includes(state.cat));
    if (state.lang) pool = pool.filter((i) => i.lang === state.lang);
    if (state.seen) {
      const cutoff = fmt.addDays(latest, -(Number(state.seen) - 1));
      pool = pool.filter((i) => i.seen && i.seen >= cutoff);
    }
    if (state.created) {
      const cutoff = fmt.addDays(latest, -Number(state.created));
      pool = pool.filter((i) => i.created && i.created >= cutoff);
    }
    if (state.explained) pool = pool.filter((i) => i.explained);
    return pool;
  }

  function update(resetLimit = true) {
    if (resetLimit) limit = PAGE;
    const sort = state.sort || (state.q ? 'relevance' : 'g7');
    const base = filtered();
    let items = state.q ? searchItems(catalog, state.q, search?.texts, base) : [...base];
    if (sort !== 'relevance') items.sort(COMPARE[sort]);

    const counts = new Map();
    for (const item of filtered(true)) for (const t of item.tags) counts.set(t, (counts.get(t) || 0) + 1);
    paint($('cat-chips'), html`<button type="button" class="chip" data-cat="" aria-pressed="${!state.cat}">全部</button>
      ${catalog.tags.map((t) => html`<button type="button" class="chip ${counts.get(t) ? '' : 'dim'}" data-cat="${t}" aria-pressed="${t === state.cat}">${t}<span class="count">${counts.get(t) || 0}</span></button>`)}`);
    paint($('f-sort'), SORTS.filter(([v]) => v !== 'relevance' || state.q).map(([v, l]) => html`<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`));
    paint($('result-count'), html`<span>找到 <b class="num" style="color:var(--ink)">${fmt.int(items.length)}</b> 个项目</span>
      ${state.q && !search ? html`<span class="muted">正在载入简介与话题索引…</span>` : ''}
      ${sort === 'g7' ? html`<span class="muted">近 7 天 = 本站观测（截至 ${catalog.starDate}）</span>` : ''}`);
    const shown = items.slice(0, limit);
    paint($('results'), items.length ? html`<ol class="rows">${shown.map((item) => listRow({
      name: item.name, zh: item.zh, desc: search?.descs[item.i], tags: item.tags, lang: item.lang, created: item.created,
      today: latest, gone: item.gone, stars: item.stars, starsDate: item.starDate,
      observed: item.g7 != null ? [item.g7, item.g7span] : null, days: item.n, streak: item.streak,
      note: item.seen ? `最近上榜 ${item.seen === latest ? '今天' : item.seen}` : '',
    }))}</ol>
      ${items.length > limit ? html`<div class="load-more"><button type="button" class="btn" id="more">显示更多（还有 ${fmt.int(items.length - limit)} 个）</button></div>` : ''}`
      : html`<div class="state"><h2>没有符合条件的项目</h2><p>可以减少筛选条件，或换一个关键词。</p>
        <button type="button" class="btn" id="reset">清除筛选</button></div>`);
  }

  function sync() {
    history.replaceState(null, '', href.explore({
      q: state.q, cat: state.cat, lang: state.lang, seen: state.seen, created: state.created,
      explained: state.explained, sort: state.sort,
    }));
    update();
  }

  let timer = 0;
  $('explore-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); state.sort = state.sort === 'relevance' && !state.q ? '' : state.sort; sync(); }, 160);
  });
  $('explore-form').addEventListener('submit', (e) => { e.preventDefault(); $('explore-q').blur(); });
  $('f-lang').addEventListener('change', (e) => { state.lang = e.target.value; sync(); });
  $('f-seen').addEventListener('change', (e) => { state.seen = e.target.value; sync(); });
  $('f-created').addEventListener('change', (e) => { state.created = e.target.value; sync(); });
  $('f-explained').addEventListener('change', (e) => { state.explained = e.target.checked; sync(); });
  $('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; sync(); });
  const onClick = (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) { state.cat = chip.dataset.cat; sync(); return; }
    if (e.target.closest('#more')) { limit += PAGE * 2; update(false); return; }
    if (e.target.closest('#reset')) {
      Object.assign(state, { q: '', cat: '', lang: '', seen: '', created: '', explained: false, sort: '' });
      $('explore-q').value = '';
      ['f-lang', 'f-seen', 'f-created'].forEach((id) => { $(id).value = ''; });
      $('f-explained').checked = false;
      sync();
    }
  };
  root.addEventListener('click', onClick);
  update();
  if (!state.q && window.matchMedia('(min-width: 720px)').matches) $('explore-q').focus({ preventScroll: true });
  return () => root.removeEventListener('click', onClick);
}
