'use strict';

const DATA = 'data/';
const SOURCE_REPO = 'https://github.com/KBOZAI/github-trending-daily';
const view = document.getElementById('view');
const cache = new Map();
let INDEX = null;
let charts = [];

const PERIOD = { daily: '今日', weekly: '本周', monthly: '本月' };
const GAIN = { daily: '今日新增星', weekly: '本周新增星', monthly: '本月新增星' };
const LANG_COLORS = {
  Python: '#3572A5', TypeScript: '#3178c6', JavaScript: '#f1e05a', Go: '#00ADD8', Rust: '#dea584',
  Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Shell: '#89e051',
  'Jupyter Notebook': '#DA5B0B', HTML: '#e34c26', CSS: '#663399', Swift: '#F05138', Kotlin: '#A97BFF',
  Ruby: '#701516', PHP: '#4F5D95', Dart: '#00B4AB', Vue: '#41b883', Zig: '#ec915c', Lua: '#000080',
  MDX: '#fcb32c', Svelte: '#ff3e00', Dockerfile: '#384d54', Nix: '#7e7eff', Elixir: '#6e4a7e',
  'Objective-C': '#438eff', Scala: '#c22d40', Haskell: '#5e5086', R: '#198CE7', Julia: '#a270ba',
  PowerShell: '#012456', Astro: '#ff5a03', 'Vim Script': '#199f4b', TeX: '#3D6117', Makefile: '#427819',
  Cuda: '#3A4E3A', Clojure: '#db5855', OCaml: '#ef7a08', Solidity: '#AA6746', 'Emacs Lisp': '#c065db',
  '无语言(文档类)': '#b7ada1', 其他: '#cfd3d8',
};

// Python and TypeScript are both blue in GitHub's palette; separate them in stacked charts.
const CHART_COLORS = { TypeScript: '#8b5cf6' };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (n == null ? '–' : n.toLocaleString('zh-CN'));
const short = (n) => (n == null ? '–' : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万` : n.toLocaleString('zh-CN'));
const signed = (n) => (n > 0 ? '+' : '') + num(n);
const localTime = (iso) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const langDot = (lang) => `<span class="lang"><i class="dot" style="background:${LANG_COLORS[lang] || '#9aa1a9'}"></i>${esc(lang)}</span>`;
const repoLink = (name) => `#/repo/${name}`;

function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(DATA + path).then((r) => {
      if (!r.ok) throw new Error(`${path}：HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

function dayHref(date, list = 'all', period = 'daily', tag = '') {
  const q = new URLSearchParams();
  if (list !== 'all') q.set('list', list);
  if (period !== 'daily') q.set('period', period);
  if (tag) q.set('tag', tag);
  const s = q.toString();
  return `#/day/${date}${s ? `?${s}` : ''}`;
}

function mkChart(id, option) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  const fg = css('--muted');
  const line = css('--line');
  const axis = { axisLabel: { color: fg }, axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } } };
  for (const k of ['xAxis', 'yAxis']) if (option[k]) option[k] = { ...axis, ...option[k],
    axisLabel: { ...axis.axisLabel, ...option[k].axisLabel } };
  if (option.tooltip) option.tooltip = { backgroundColor: css('--panel'), borderColor: line,
    textStyle: { color: css('--fg') }, ...option.tooltip };
  chart.setOption({ useUTC: true, textStyle: { fontFamily: 'inherit' }, animationDuration: 400, ...option });
  charts.push(chart);
}

function disposeCharts() {
  charts.forEach((c) => c.dispose());
  charts = [];
}

// ---------- routing ----------
async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(qs);
  const page = parts[0] || 'day';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === page));
  disposeCharts();
  window.scrollTo(0, 0);
  try {
    if (page === 'stats') await viewStats();
    else if (page === 'about') viewAbout();
    else if (page === 'repo') await viewRepo(parts.slice(1).join('/'));
    else if (page === 'search') await viewSearch(params.get('q') || '');
    else await viewDay(parts[1], params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="empty">加载失败：${esc(e.message)}</p>`;
  }
}

// ---------- day view ----------
function card(it, ctx) {
  const [owner, name] = it.repo.split('/');
  const badges = [];
  if (it.gone) badges.push('<span class="badge gone">已删除或转私有</span>');
  if (ctx.daily) {
    if (it.new && ctx.hist) badges.push('<span class="badge new">首次上榜</span>');
    if (it.st >= 2) badges.push(`<span class="badge streak" title="连续有效采样；疑似未更新日和无数据日期不计">连续 ${it.st} 次采样</span>`);
    if (it.n >= 2 && it.n > (it.st || 0)) badges.push(`<span class="badge total">累计 ${it.n} 天</span>`);
  }
  const facts = [];
  if (it.lang) facts.push(langDot(it.lang));
  if (it.forks != null) facts.push(`<span title="Fork 数">⑂ ${short(it.forks)}</span>`);
  if (it.created) facts.push(`<span title="仓库创建日期 ${esc(it.created)}">创建于 ${esc(it.created.slice(0, 7))}</span>`);
  (it.tags || []).forEach((t) => facts.push(`<span class="tag">${esc(t)}</span>`));
  (it.topics || []).slice(0, 4).forEach((t) => facts.push(`<span class="topic">${esc(t)}</span>`));
  facts.push(`<a class="github-link" href="https://github.com/${esc(it.repo)}" target="_blank" rel="noopener">GitHub ↗</a>`);
  const latestTotal = ctx.latest && it.stars_latest != null;
  const total = latestTotal ? it.stars_latest : it.stars ?? it.stars_now;
  const metrics = `<div class="card-metrics">
    <div class="star-total" title="${latestTotal ? `最新总 Stars 记录于 ${it.stars_latest_date} UTC；新增 Stars 来自该榜单的采样` : it.stars != null ? '榜单采集时的总 Stars' : `最近记录于 ${it.stars_now_date || '–'}，不是历史当天的星数`}"><span>${it.stars != null ? '总 Stars' : '最新记录总 Stars'}</span><b>${num(total)}</b></div>
    ${it.gained != null ? `<div class="star-gain"><span>${GAIN[ctx.period]}</span><b>${signed(it.gained)}</b></div>` : ''}
    <a class="trend-link" href="${repoLink(it.repo)}">Stars 趋势 <span>↗</span></a>
  </div>`;
  return `<article class="card"><div class="rank">${it.rank}</div><div class="body">
    <div class="name"><a href="${repoLink(it.repo)}"><span class="owner">${esc(owner)} / </span>${esc(name)}</a><span class="badges">${badges.join('')}</span></div>
    ${it.zh ? `<p class="zh">${esc(it.zh)}</p>` : ''}
    ${it.intro?.use_cases?.length ? `<p class="card-use"><span>用途</span>${esc(it.intro.use_cases[0])}</p>` : ''}
    ${!it.zh && it.desc ? `<p class="desc">${esc(it.desc)}</p>` : ''}
    <div class="facts">${facts.join('')}</div></div>${metrics}</article>`;
}

async function viewDay(date, params) {
  const { dates } = INDEX;
  if (!dates.includes(date)) date = INDEX.latest;
  let list = params.get('list') || 'all';
  let period = params.get('period') || 'daily';
  const tag = params.get('tag') || '';
  const sort = ['rank', 'stars', 'gained'].includes(params.get('sort')) ? params.get('sort') : 'rank';
  const day = await getJSON(`days/${date}.json`);
  if (!day.lists[`${list}:${period}`]) { list = 'all'; period = 'daily'; }
  const L = day.lists[`${list}:${period}`];
  const cfg = INDEX.lists.find((l) => l.key === list);
  const i = dates.indexOf(date);
  const prev = dates[i - 1];
  const next = dates[i + 1];

  const listPills = INDEX.lists.map((l) => {
    const d = day.lists[`${l.key}:daily`];
    const href = dayHref(date, l.key, l.key === list ? period : 'daily');
    return `<a class="pill ${l.key === list ? 'on' : ''} ${d ? '' : 'off'}" href="${href}">${esc(l.name)}${d ? `<span class="c">${d.items.length}</span>` : ''}</a>`;
  }).join('');
  const periodPills = cfg && cfg.periods.length > 1
    ? `<div class="pills">${cfg.periods.map((p) => `<a class="pill ${p === period ? 'on' : ''} ${day.lists[`${list}:${p}`] ? '' : 'off'}" href="${dayHref(date, list, p)}">${PERIOD[p]}</a>`).join('')}</div>` : '';

  const items = L.items;
  const tagCount = {};
  items.forEach((it) => (it.tags || []).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const tagPills = Object.keys(tagCount).length > 1
    ? `<div class="pills">${[['', '全部', items.length], ...Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, t, c])]
      .map(([t, label, c]) => `<a class="pill ${t === tag ? 'on' : ''}" href="${dayHref(date, list, period, t)}">${esc(label)}<span class="c">${c}</span></a>`).join('')}</div>` : '';
  const shown = (tag ? items.filter((it) => (it.tags || []).includes(tag)) : [...items]);
  const totalStars = (it) => (date === INDEX.latest ? it.stars_latest : null) ?? it.stars ?? it.stars_now ?? -1;
  if (sort === 'stars') shown.sort((a, b) => totalStars(b) - totalStars(a) || a.rank - b.rank);
  if (sort === 'gained') shown.sort((a, b) => (b.gained ?? -1) - (a.gained ?? -1) || a.rank - b.rank);
  const daily = period === 'daily';
  const newCount = items.filter((it) => it.new).length;

  const summary = [`<span><b>${items.length}</b> 个项目</span>`];
  if (daily && L.hist) summary.push(`<span>首次上榜 <b>${newCount}</b></span>`);
  if (day.captured_at) summary.push(`<span>抓取于 ${localTime(day.captured_at)}</span>`);
  const notices = [];
  if (day.stale) notices.push('这一天的总榜与前一天完全相同，疑似 GitHub 端没有更新（例如 2025-11-13 至 12-04 的故障），不计入上榜天数统计。');
  if (day.src === 'backfill') notices.push('这一天来自历史归档，只记录了排名；简介、语言和星数是现在的数据。');

  view.innerHTML = `
    <section class="day-intro">
      <div><p class="eyebrow">GITHUB TRENDING · ${date} UTC</p><h1>发现开源，追踪增长</h1><p class="intro-copy">了解项目做什么、有什么用，查看总 Stars 与长期变化。</p></div>
      <span class="source-badge"><i></i>${day.src === 'live' ? '实抓榜单' : '历史排名归档'}</span>
    </section>
    <div class="bar">
      <div class="datenav">
        <a class="btn" href="${prev ? dayHref(prev, list, period) : '#'}" ${prev ? '' : 'disabled'} title="前一天（←）">‹</a>
        <input class="btn" type="date" id="date" value="${date}" min="${dates[0]}" max="${dates[dates.length - 1]}">
        <a class="btn" href="${next ? dayHref(next, list, period) : '#'}" ${next ? '' : 'disabled'} title="后一天（→）">›</a>
        ${date !== INDEX.latest ? `<a class="btn" href="${dayHref(INDEX.latest, list, period)}">最新</a>` : ''}
      </div>
      <span class="meta-line">${summary.join(' · ')}</span>
    </div>
    <div class="pills">${listPills}</div>
    ${periodPills ? `<div style="margin-top:8px">${periodPills}</div>` : ''}
    ${notices.map((n) => `<p class="notice">${n}</p>`).join('')}
    ${tagPills ? `<div style="margin-top:12px">${tagPills}</div>` : ''}
    <div class="list-toolbar"><span>${esc(cfg?.name || '总榜')} · ${PERIOD[period]} · ${shown.length} 个项目</span><label>排序 <select id="sort" aria-label="项目排序">
      <option value="rank" ${sort === 'rank' ? 'selected' : ''}>Trending 排名</option>
      <option value="stars" ${sort === 'stars' ? 'selected' : ''}>总 Stars</option>
      <option value="gained" ${sort === 'gained' ? 'selected' : ''} ${items.some((it) => it.gained != null) ? '' : 'disabled'}>新增 Stars</option>
    </select></label></div>
    <div class="cards" style="margin-top:14px">${shown.length
      ? shown.map((it) => card(it, { daily, hist: L.hist, period, latest: date === INDEX.latest })).join('')
      : '<p class="empty">这一天这个榜单没有项目。</p>'}</div>`;

  document.getElementById('date').addEventListener('change', (e) => {
    const want = e.target.value;
    const pick = [...dates].reverse().find((d) => d <= want) || dates[0];
    location.hash = dayHref(pick, list, period);
  });
  document.getElementById('sort').addEventListener('change', (e) => {
    const q = new URLSearchParams(params);
    if (e.target.value === 'rank') q.delete('sort'); else q.set('sort', e.target.value);
    location.hash = `#/day/${date}${q.size ? '?' + q.toString() : ''}`;
  });
  view.dataset.prev = prev ? dayHref(prev, list, period) : '';
  view.dataset.next = next ? dayHref(next, list, period) : '';
}

// ---------- stats view ----------
function topRepos(repos, win) {
  const cutDate = win ? new Date(Date.parse(INDEX.latest) - (win - 1) * 864e5).toISOString().slice(0, 10) : '';
  const cut = win ? INDEX.dates.findIndex((d) => d >= cutDate) : 0;
  const out = [];
  for (const [name, r] of Object.entries(repos)) {
    if (!r.a) continue;
    const c = win ? r.a.h.filter(([d]) => d >= cut).length : r.a.n;
    if (c) out.push([name, r, c]);
  }
  return out.sort((a, b) => b[2] - a[2] || a[1].a.b - b[1].a.b).slice(0, 20);
}

function bar(value, max, width = 64) {
  return `<i style="width:${Math.max(3, Math.round((width * value) / max))}px"></i>`;
}

async function viewStats() {
  view.innerHTML = '<p class="empty">加载中…</p>';
  const [stats, repos] = await Promise.all([getJSON('stats.json'), getJSON('repos.json')]);
  const wins = [[30, '近 30 天'], [90, '近 90 天'], [365, '近 1 年'], [0, '全部']];
  view.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${num(INDEX.dates.length)}</b><span>收录天数（自 ${INDEX.dates[0]}）</span></div>
      <div class="kpi"><b>${num(stats.unique_repos)}</b><span>上过总榜的项目</span></div>
      <div class="kpi"><b>${stats.size_30}</b><span>近 30 个有效观测日平均项目数</span></div>
      <div class="kpi"><b>${stats.new_30}</b><span>近 30 个有效观测日平均首次上榜</span></div>
    </div>
    <section class="panel">
      <h2>上榜天数排行 <span class="pills" id="win">${wins.map(([w, l]) => `<a class="pill ${w === 30 ? 'on' : ''}" data-w="${w}" href="javascript:">${l}</a>`).join('')}</span></h2>
      <p class="hint">按总榜上榜天数排序（疑似未更新的日子不计入）。</p>
      <div class="rows" id="top"></div>
    </section>
    <section class="panel">
      <h2>AI 相关项目占比</h2>
      <p class="hint">每月总榜条目中，名称、简介或话题含 AI 关键词（llm、agent、mcp、claude、diffusion…）的比例，关键词估计，看趋势用。</p>
      <div class="chart" id="c-ai"></div>
    </section>
    <section class="panel">
      <h2>编程语言占比</h2>
      <p class="hint">每月总榜条目的主要语言；"无语言"多为教程、清单类仓库。</p>
      <div class="chart" id="c-lang" style="height:360px"></div>
    </section>
    <div class="grid2">
      <section class="panel">
        <h2>近 30 个有效观测日热门话题</h2>
        <p class="hint">上榜项目的 GitHub topics 出现次数（项目 × 有效观测日），括号内为前 30 个有效观测日。</p>
        <div class="rows" id="topics"></div>
      </section>
      <section class="panel">
        <h2>上榜项目最多的作者 / 组织</h2>
        <p class="hint">上过总榜的不同项目数 · 累计项目上榜天数</p>
        <div class="rows" id="owners"></div>
      </section>
    </div>`;

  const renderTop = (win) => {
    const top = topRepos(repos, win);
    const max = top.length ? top[0][2] : 1;
    document.getElementById('top').innerHTML = top.map(([name, r, c], i) => `
      <div class="row"><span class="i">${i + 1}</span>
        <span class="t"><a href="${repoLink(name)}">${esc(name)}</a><small>${esc(r.zh || r.d || '')}</small></span>
        <span class="v">${bar(c, max)}${c} 天</span></div>`).join('') || '<p class="empty">暂无数据</p>';
  };
  renderTop(30);
  document.getElementById('win').addEventListener('click', (e) => {
    const a = e.target.closest('[data-w]');
    if (!a) return;
    e.preventDefault();
    document.querySelectorAll('#win .pill').forEach((p) => p.classList.toggle('on', p === a));
    renderTop(Number(a.dataset.w));
  });

  const tmax = Math.max(1, ...stats.topics.map((t) => t.n));
  document.getElementById('topics').innerHTML = stats.topics.slice(0, 15).map((t, i) => `
    <div class="row"><span class="i">${i + 1}</span>
      <span class="t"><a href="#/search?q=${encodeURIComponent(t.t)}">#${esc(t.t)}</a></span>
      <span class="v">${bar(t.n, tmax, 48)}${t.n}<small class="${t.n >= t.prev ? 'up' : 'down'}">(${t.prev})</small></span></div>`).join('');
  const omax = Math.max(1, ...stats.owners.map((o) => o.repos));
  document.getElementById('owners').innerHTML = stats.owners.slice(0, 15).map((o, i) => `
    <div class="row"><span class="i">${i + 1}</span>
      <span class="t"><a href="https://github.com/${esc(o.o)}" target="_blank" rel="noopener">${esc(o.o)}</a></span>
      <span class="v">${bar(o.repos, omax, 48)}${o.repos} · ${o.days} 天</span></div>`).join('');

  mkChart('c-ai', {
    grid: { left: 44, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
    xAxis: { type: 'category', data: stats.months, boundaryGap: false },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: css('--muted') } },
    series: [{ type: 'line', name: 'AI 相关', data: stats.ai, smooth: true, symbol: 'none', color: css('--accent'), lineStyle: { width: 2.5 }, areaStyle: { opacity: 0.12 } }],
  });
  mkChart('c-lang', {
    grid: { left: 44, right: 16, top: 64, bottom: 28 },
    legend: { top: 0, textStyle: { color: css('--muted') }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%`, order: 'seriesDesc' },
    xAxis: { type: 'category', data: stats.months, boundaryGap: false },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: css('--muted') } },
    series: Object.entries(stats.lang).map(([l, data]) => ({
      name: l, type: 'line', stack: 'all', data, symbol: 'none', lineStyle: { width: 0 },
      areaStyle: { opacity: 0.9 }, color: CHART_COLORS[l] || LANG_COLORS[l] || '#9aa1a9', emphasis: { focus: 'series' },
    })),
  });
}

// ---------- repo view ----------
async function viewRepo(name) {
  const repos = await getJSON('repos.json');
  const key = repos[name] ? name : Object.keys(repos).find((k) => k.toLowerCase() === name.toLowerCase());
  const r = repos[key];
  if (!r) {
    view.innerHTML = `<p class="empty">没有 ${esc(name)} 的上榜记录。<a href="https://github.com/${esc(name)}" target="_blank" rel="noopener">去 GitHub 看看 →</a></p>`;
    return;
  }
  let points = [];
  let historyFailed = false;
  if (r.star_history) {
    try { points = (await getJSON(r.star_history.file)).points; }
    catch (e) { historyFailed = true; console.warn(e.message); }
  }
  const first = points[0];
  const last = points[points.length - 1];
  const delta = points.length > 1 ? last[1] - first[1] : null;
  const facts = [];
  if (r.l) facts.push(langDot(r.l));
  if (r.c) facts.push(`<span>仓库创建 ${esc(r.c)}</span>`);
  if (r.lic && r.lic !== 'NOASSERTION') facts.push(`<span>${esc(r.lic)}</span>`);
  if (r.hp) facts.push(`<a href="${esc(r.hp)}" target="_blank" rel="noopener">项目主页 ↗</a>`);
  (r.tags || []).forEach((t) => facts.push(`<span class="tag">${esc(t)}</span>`));
  (r.t || []).forEach((t) => facts.push(`<span class="topic">${esc(t)}</span>`));
  const a = r.a;
  const listName = Object.fromEntries(INDEX.lists.map((l) => [`${l.key}:daily`, l.name]));
  const others = Object.entries(r.o || {}).map(([k, n]) => `${esc(listName[k] || k)} ${n} 天`).join(' · ');
  view.innerHTML = `
    <div class="breadcrumb"><a href="${dayHref(INDEX.latest)}">← 返回榜单</a><a href="https://github.com/${esc(key)}" target="_blank" rel="noopener">在 GitHub 打开 ↗</a></div>
    <section class="panel repo-head">
      <div class="repo-intro"><p class="eyebrow">PROJECT / STARS</p><h1>${esc(key)} ${r.gone ? '<span class="badge gone">已删除或转私有</span>' : ''}</h1>
      ${r.zh ? `<p class="zh">${esc(r.zh)}</p>` : ''}${r.d ? `<p class="desc">${esc(r.d)}</p>` : ''}
      <div class="facts">${facts.join('')}</div></div>
      <div class="repo-star-total"><span>最新记录总 Stars</span><b>${num(r.s)}</b><small>${r.star_history ? `${r.star_history.last} UTC` : '来自现存元信息缓存'}</small></div>
    </section>
    <section class="panel project-guide">
      <div class="section-heading"><div><p class="eyebrow">PROJECT GUIDE</p><h2>这个项目能做什么</h2></div></div>
      ${r.intro?.what ? `<p class="project-what">${esc(r.intro.what)}</p>
      <div class="guide-grid">
        ${r.intro.use_cases?.length ? `<div><h3>可以用来</h3><ul>${r.intro.use_cases.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${r.intro.audience ? `<div><h3>适合谁</h3><p>${esc(r.intro.audience)}</p></div>` : ''}
      </div>
      <p class="guide-source">根据项目公开资料整理${r.intro_source?.url ? ` · <a href="${esc(r.intro_source.url)}" target="_blank" rel="noopener">查看原始资料 ↗</a>` : ''}${r.intro_date ? ` · ${esc(r.intro_date)} 更新` : ''}</p>`
      : `<p class="project-what">${esc(r.zh || r.d || '项目尚未提供可用简介。')}</p><p class="guide-source">${r.zh ? '现有中文简介' : '项目原文简介'} · <a href="https://github.com/${esc(key)}#readme" target="_blank" rel="noopener">查看 README ↗</a></p>`}
    </section>
    <section class="panel stars-panel">
      <div class="section-heading"><div><p class="eyebrow">STAR HISTORY</p><h2>Stars 数量变化</h2></div>
      <div class="pills" id="star-window" aria-label="Stars 图表时间范围">${[[7, '7 天'], [30, '30 天'], [90, '90 天'], [0, '全部记录']].map(([w, label]) => `<button type="button" class="pill ${w === 0 ? 'on' : ''}" data-days="${w}">${label}</button>`).join('')}</div></div>
      <div class="star-overview">
        <div><span>首次记录</span><b>${first ? num(first[1]) : '–'}</b><small>${first ? first[0] : '暂无采样'}</small></div>
        <div><span>记录以来净变化</span><b class="${delta != null && delta >= 0 ? 'up' : ''}">${delta == null ? '–' : signed(delta)}</b><small>${delta != null && first[1] > 0 ? `${signed(Number((100 * delta / first[1]).toFixed(1)))}%` : '需要至少两个观测日'}</small></div>
        <div><span>实际观测日</span><b>${points.length}</b><small>每日独立记录总 Stars</small></div>
      </div>
      ${points.length ? '<div class="chart" id="c-stars"></div><p class="hint star-caption" id="star-caption"></p>' : `<div class="chart-empty">${historyFailed ? 'Stars 记录暂时加载失败，请刷新重试。' : '尚无可用 Stars 观测，采集到后会在这里显示。'}</div>`}
      <p class="data-note">从本站首次记录该项目时开始追踪；项目离榜后仍继续每日采样。早期排名归档没有历史 Stars，不补造观测值。${points.length === 1 ? '目前只有一个观测日，先显示单点，获得下一次采样后即可连成折线。' : ''}</p>
    </section>
    ${a ? `<div class="statline">
      <div class="kpi"><b>${a.n}</b><span>总榜上榜天数</span></div>
      <div class="kpi"><b>#${a.b}</b><span>最好名次</span></div>
      <div class="kpi"><b>${a.ms}</b><span>最长连续有效采样</span></div>
      <div class="kpi"><b>${a.f}</b><span>首次上榜</span></div>
      <div class="kpi"><b>${a.l}</b><span>最近上榜</span></div>
    </div>` : '<p class="notice">该项目目前只收录于分榜。</p>'}
    ${others ? `<p class="summary">其他榜单：${others}</p>` : ''}
    ${a ? '<section class="panel"><h2>总榜名次记录</h2><p class="hint">每个点是一个有效上榜日，越靠上名次越高。</p><div class="chart" id="c-rank" style="height:260px"></div></section>' : ''}`;
  if (points.length) {
    const renderStars = (days) => {
      const cut = days ? Date.parse(last[0]) - (days - 1) * 864e5 : -Infinity;
      const selected = points.filter(([date]) => Date.parse(date) >= cut);
      const current = charts.find((c) => c.getDom().id === 'c-stars');
      if (current) { current.dispose(); charts = charts.filter((c) => c !== current); }
      mkChart('c-stars', {
        grid: { left: 76, right: 30, top: 24, bottom: 44 },
        tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => `${num(v)} Stars` },
        xAxis: { type: 'time', minInterval: 864e5,
          axisLabel: { hideOverlap: true, formatter: (v) => new Date(v).toISOString().slice(5, 10) } },
        yAxis: { type: 'value', scale: true, minInterval: 1, axisLabel: { formatter: (v) => num(v), color: css('--muted') } },
        series: [{ name: '总 Stars', type: 'line', smooth: false, showSymbol: selected.length < 45,
          symbol: 'circle', symbolSize: 9, color: css('--accent'), lineStyle: { width: 3 },
          areaStyle: { opacity: 0.08 }, data: selected.map(([date, stars]) => [date, stars]) }],
      });
      document.getElementById('star-caption').textContent = `${selected[0][0]} 至 ${selected[selected.length - 1][0]} · ${selected.length} 个 UTC 观测日 · 连线连接实际采样点，缺失日期不补值`;
    };
    renderStars(0);
    document.getElementById('star-window').addEventListener('click', (e) => {
      const button = e.target.closest('[data-days]');
      if (!button) return;
      document.querySelectorAll('#star-window button').forEach((b) => b.classList.toggle('on', b === button));
      renderStars(Number(button.dataset.days));
    });
  } else {
    document.querySelectorAll('#star-window button').forEach((b) => { b.disabled = true; });
  }
  if (a) {
    const maxRank = Math.max(10, ...a.h.map(([, rank]) => rank));
    mkChart('c-rank', {
      grid: { left: 36, right: 16, top: 12, bottom: 28 },
      tooltip: { trigger: 'item', confine: true, formatter: (p) => `${p.value[0]}<br>第 ${p.value[1]} 名` },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', inverse: true, min: 0, max: Math.ceil(maxRank / 5) * 5, interval: 5,
        axisLabel: { color: css('--muted'), formatter: (v) => v || '' } },
      series: [{ type: 'scatter', symbolSize: 7, color: css('--muted'), data: a.h.map(([date, rank]) => [INDEX.dates[date], rank]) }],
    });
  }
}

// ---------- search ----------
async function viewSearch(q) {
  document.getElementById('search').value = q;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) { view.innerHTML = '<p class="empty">输入关键词搜索上过榜的项目。</p>'; return; }
  view.innerHTML = '<p class="empty">搜索中…</p>';
  const repos = await getJSON('repos.json');
  const hits = [];
  for (const [name, r] of Object.entries(repos)) {
    const hay = `${name} ${r.d || ''} ${r.zh || ''} ${r.intro?.what || ''} ${(r.intro?.use_cases || []).join(' ')} ${(r.t || []).join(' ')} ${(r.tags || []).join(' ')}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) hits.push([name, r]);
  }
  hits.sort((x, y) => (y[1].a?.n || 0) - (x[1].a?.n || 0) || (y[1].s || 0) - (x[1].s || 0));
  view.innerHTML = `
    <p class="summary"><span>“${esc(q)}”：<b>${hits.length}</b> 个上过榜的项目${hits.length > 100 ? '，显示前 100 个' : ''}</span></p>
    <section class="panel"><div class="rows">${hits.slice(0, 100).map(([name, r], i) => `
      <div class="row"><span class="i">${i + 1}</span>
        <span class="t"><a href="${repoLink(name)}">${esc(name)}</a><small>${esc(r.zh || r.d || '')}</small></span>
        <span class="v">${r.a ? `总榜 ${r.a.n} 天` : '仅分榜'}</span></div>`).join('') || '<p class="empty">没有找到。</p>'}</div></section>`;
}

// ---------- about ----------
function viewAbout() {
  const bf = INDEX.backfill;
  view.innerHTML = `<article class="prose">
    <h2>这是什么</h2>
    <p>每天自动收集 <a href="https://github.com/trending" target="_blank" rel="noopener">GitHub Trending</a> 热榜，配上中文简介，记录每个项目的上榜历史，并做长期统计。</p>
    <h2>数据怎么来的</h2>
    <ul>
      <li>每天 UTC 00:17（北京时间 08:17）由 GitHub Actions 抓取：总榜（今日 / 本周 / 本月）、中文项目榜，以及 Python、Jupyter、TypeScript、JavaScript、Go、Rust、Java、C++ 语言榜。</li>
      <li>用 GitHub API 补充话题、创建时间、许可证等信息；项目中文介绍根据公开简介与 README 整理，说明做什么、具体用途及适用人群，详情页提供资料来源。</li>
      <li>每天独立记录所有已收录且可访问仓库的总 Stars，项目离榜后仍继续跟踪。点项目名或“Stars 趋势”即可查看曲线。</li>
      <li>日期按抓取时的 UTC 日期记；GitHub 的“今日”榜是过去 24 小时的滚动窗口。</li>
    </ul>
    <h2>历史数据</h2>
    <p>${bf ? `${bf.from} 至 ${INDEX.live_since || bf.to} 之前的总榜来自 <a href="${esc(bf.source)}" target="_blank" rel="noopener">antonkomarev/github-trending-archive</a>（MIT 许可），只有排名；这些天显示的简介、语言、星数是现在的数据。` : '暂无。'}
      自己抓取从 ${esc(INDEX.live_since || '–')} 开始。</p>
    <h2>统计口径</h2>
    <ul>
      <li>上榜次数按各日榜分别计算；项目页的主要指标和统计排行使用总榜“今日”榜。总榜与上一个有数据日期完全相同时，标为疑似未更新（目前共 ${INDEX.stale.length} 天），该日各日榜不计数。</li>
      <li>连续次数按相邻有效采样计算，会跳过疑似未更新日和缺失日期，不代表严格连续的日历天数。上榜排行的近 30/90/365 天按日历日期筛选；热门话题及平均项目数使用最近 30 个有效观测日。</li>
      <li>改过名的仓库合并到新名字下；已删除或转私有的仓库保留记录。</li>
      <li>AI 相关占比按关键词估计，只适合看趋势。</li>
    </ul>
    <h2>源码与原始数据</h2>
    <p><a href="${SOURCE_REPO}" target="_blank" rel="noopener">${SOURCE_REPO.replace('https://', '')}</a>：每日快照在 <code>data/snapshots/</code>，可以直接下载分析。</p>
  </article>`;
}

// ---------- init ----------
(async function init() {
  try {
    INDEX = await getJSON('index.json');
  } catch (e) {
    view.innerHTML = `<p class="empty">数据加载失败：${esc(e.message)}</p>`;
    return;
  }
  document.getElementById('foot').innerHTML = `最新榜单 ${INDEX.latest}（UTC） · 网页生成于 ${localTime(INDEX.generated)} · 来源 GitHub Trending · <a href="${SOURCE_REPO}" target="_blank" rel="noopener">源码</a>`;
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('search').value.trim();
    location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : '#/';
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const to = e.key === 'ArrowLeft' ? view.dataset.prev : e.key === 'ArrowRight' ? view.dataset.next : '';
    if (to) location.hash = to;
  });
  window.addEventListener('hashchange', () => { view.dataset.prev = ''; view.dataset.next = ''; route(); });
  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));
  route();
}());
