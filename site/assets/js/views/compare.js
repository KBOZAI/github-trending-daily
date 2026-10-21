// 对比: up to four projects side by side — growth from a shared start date, list history and basics.
import { html, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadCatalog, loadRepo, loadStars, searchItems } from '../data.js';
import { lineChart } from '../charts.js';
import { COMPARE_MAX, compared, setCompared } from '../compare-store.js';
import { langDot, repoName, segmented } from '../ui.js';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const MODES = [['gain', '新增'], ['pct', '增幅 %'], ['total', '总 Stars']];

export async function render(root, route, ctx) {
  const m = getManifest();
  const catalog = await loadCatalog();
  if (!ctx.isCurrent()) return;
  document.title = '项目对比 · GitHub 热榜日报';
  let wanted = (route.query.get('r') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!wanted.length && compared().length) {
    wanted = compared();
    history.replaceState(null, '', href.compare(wanted));
  }
  const items = [];
  const missing = [];
  for (const name of wanted) {
    const item = catalog.byName.get(name.toLowerCase());
    if (item && !items.includes(item)) items.push(item); else if (!item) missing.push(name);
  }
  items.splice(COMPARE_MAX);
  setCompared(items.map((i) => i.name));
  const [records, series] = await Promise.all([
    Promise.all(items.map((i) => loadRepo(i.name).catch(() => null))),
    Promise.all(items.map((i) => loadStars(i.name).catch(() => []))),
  ]);
  if (!ctx.isCurrent()) return;

  const state = { mode: 'gain' };
  const starts = series.filter((s) => s.length).map((s) => s[0][0]);
  const common = starts.length ? starts.reduce((a, b) => (a > b ? a : b)) : null;
  const end = series.filter((s) => s.length).map((s) => s[s.length - 1][0]).reduce((a, b) => (a > b ? a : b), common);
  const dates = [];
  if (common) for (let d = common; d <= end; d = fmt.addDays(d, 1)) dates.push(d);
  const aligned = series.map((points) => {
    const map = new Map(points);
    return dates.map((d) => map.get(d) ?? null);
  });
  const go = (names) => { location.hash = href.compare(names); };

  const factRows = [
    ['一句话', (item) => item.zh || html`<span class="muted">暂无中文解读</span>`],
    ['语言', (item) => langDot(item.lang) || '–'],
    ['创建时间', (item) => item.created || '–'],
    ['总 Stars', (item) => html`<span class="num">${fmt.int(item.stars)}</span>`],
    ['近 7 天新增（本站观测）', (item) => (item.g7 != null ? html`<span class="num up">${fmt.signed(item.g7)}</span>` : '–')],
    [`${common ? fmt.shortDate(common) : ''} 以来新增`, (item, i) => {
      const values = aligned[i].filter((v) => v != null);
      return values.length > 1 && aligned[i][0] != null ? html`<span class="num up">${fmt.signed(values[values.length - 1] - aligned[i][0])}</span>` : '–';
    }],
    ['总榜上榜天数', (item) => (item.n ? `${item.n} 天` : '未上过总榜')],
    ['总榜最好名次', (item) => (item.best ? `#${item.best}` : '–')],
    ['首次上总榜', (item) => item.first || '–'],
    ['最近上榜（任一榜）', (item) => item.seen || '–'],
    ['许可证', (item, i) => records[i]?.meta?.license || '–'],
    ['适合谁', (item, i) => records[i]?.intro?.audience || '–'],
  ];

  paint(root, html`<div class="view-compare fade-in">
    <header>
      <p class="eyebrow"><span>最多 ${COMPARE_MAX} 个项目</span></p>
      <h1 class="page-title">项目对比</h1>
      <p class="lede">把候选项目放在一起看：同一起点后的 Stars 增长、上榜情况和基本信息。在任意项目卡片或档案页点“加入对比”，也可以直接在下面搜索添加。</p>
    </header>
    <form class="search-hero" id="compare-form" role="search" style="position:relative">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input id="compare-q" type="search" placeholder="${items.length >= COMPARE_MAX ? '已达到 4 个，先移除一个再添加' : '搜索并添加项目，例如 ollama'}" aria-label="添加对比项目" autocomplete="off" ${items.length >= COMPARE_MAX ? 'disabled' : ''}>
      <div class="search-results" id="compare-results" hidden style="left:0;right:auto;width:100%"></div>
    </form>
    ${missing.length ? html`<p class="notice">没有找到：${missing.join('、')}</p>` : ''}
    ${items.length ? html`
      <div class="compare-grid" style="margin-top:22px">${items.map((item, i) => html`<div class="compare-card" style="--c:${COLORS[i]}">
        <button class="remove" type="button" data-remove="${item.name}" aria-label="移除 ${item.name}">×</button>
        ${repoName(item.name)}<p style="font-size:13.5px;color:var(--ink-2)">${item.zh || ''}</p>
        <span class="num" style="font-size:13px">★ ${fmt.int(item.stars)}</span></div>`)}</div>
      <section class="section" aria-labelledby="cmp-chart-title">
        <div class="section-head"><h2 id="cmp-chart-title">Stars 走势<span class="sub">${common ? `从 ${common}（所有项目都有记录的第一天）到 ${end}` : '没有可比较的 Stars 记录'}</span></h2>
          <div class="tools" data-part="mode">${segmented(MODES, state.mode, { action: 'mode', name: '显示方式' })}</div></div>
        <div class="chart-legend">${items.map((item, i) => html`<span><i style="--c:${COLORS[i]}"></i>${item.name}</span>`)}</div>
        <div class="chart" id="cmp-chart"></div>
        <p class="foot-note">只使用本站每天的实际记录；某天没有记录时曲线断开，不做补值。“新增”= 当天总 Stars − 共同起点那天的总 Stars；“增幅”= 新增 ÷ 共同起点那天的总 Stars，适合比较体量差别很大的项目。</p>
      </section>
      <section class="section" aria-labelledby="cmp-facts-title">
        <div class="section-head"><h2 id="cmp-facts-title">逐项比较</h2></div>
        <div class="table-scroll"><table class="list-table compare-table">
          <thead><tr><th></th>${items.map((item, i) => html`<th style="border-bottom:3px solid ${COLORS[i]}"><a href="${href.repo(item.name)}">${item.name}</a></th>`)}</tr></thead>
          <tbody>${factRows.map(([label, cell]) => html`<tr><th scope="row" style="font-weight:500;color:var(--ink-3)">${label}</th>${items.map((item, i) => html`<td>${cell(item, i)}</td>`)}</tr>`)}</tbody>
        </table></div>
      </section>`
      : html`<div class="state"><h2>还没有选择项目</h2><p>在上面搜索项目，或者先去<a href="${href.home()}">今日</a>、<a href="${href.explore()}">项目库</a>挑选。</p></div>`}
  </div>`);

  const draw = () => {
    const el = root.querySelector('#cmp-chart');
    if (!el || !dates.length) return;
    lineChart(el, {
      labels: dates, label: '项目 Stars 走势对比',
      series: items.map((item, i) => ({
        name: item.name, color: COLORS[i],
        values: aligned[i].map((v) => {
          const base = aligned[i][0];
          if (v == null || state.mode === 'total') return v;
          if (base == null) return null;
          if (state.mode === 'gain') return v - base;
          return base > 0 ? Math.round(((v - base) / base) * 1000) / 10 : null;
        }),
      })),
      zero: state.mode !== 'total',
      format: (v) => (state.mode === 'gain' ? fmt.signed(v) : state.mode === 'pct' ? `${v > 0 ? '+' : ''}${v}%` : fmt.int(v)),
      tickFormat: (v) => (state.mode === 'pct' ? `${v}%` : fmt.compact(v)), labelFormat: fmt.shortDate, tipLabel: (d) => `${fmt.md(d)}（UTC）`,
    });
  };
  draw();

  const input = root.querySelector('#compare-q');
  const results = root.querySelector('#compare-results');
  let found = [];
  input.addEventListener('input', () => {
    const q = input.value.trim();
    found = q ? searchItems(catalog, q).filter((i) => !items.includes(i)).slice(0, 6) : [];
    paint(results, found.length ? found.map((item) => html`<a role="option" href="${href.compare([...items.map((i) => i.name), item.name])}">
      <span class="sr-name">${item.name}</span><span class="sr-stars num">★ ${fmt.compact(item.stars)}</span><span class="sr-zh">${item.zh || item.lang || ''}</span></a>`)
      : html`<p class="sr-empty">${q ? '没有找到' : ''}</p>`);
    results.hidden = !q;
  });
  root.querySelector('#compare-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (found[0]) go([...items.map((i) => i.name), found[0].name]);
  });
  const onClick = (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) { go(items.map((i) => i.name).filter((n) => n !== remove.dataset.remove)); return; }
    const mode = e.target.closest('button[data-action="mode"]');
    if (mode) {
      state.mode = mode.dataset.value;
      paint(root.querySelector('[data-part="mode"]'), segmented(MODES, state.mode, { action: 'mode', name: '显示方式' }));
      draw();
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
