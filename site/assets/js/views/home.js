// 今日: the latest edition — what is trending, what is new, what is growing, what keeps coming back.
import { html, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadHome, listLabel, PERIODS } from '../data.js';
import { repoName, segmented, notice } from '../ui.js';
import { storyCard, listRow, fromBrief } from './cards.js';

const RISER_TABS = [['g7', '近 7 天'], ['g1', '近 1 天'], ['rel7', '7 天增幅']];

function tagCounts(home, names) {
  const counts = new Map();
  for (const name of names) for (const tag of home.repos[name]?.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function lede(home, todayNames) {
  const overall = home.lists['all:daily'] || [];
  const fresh = home.newcomers.length;
  const explained = todayNames.filter((n) => home.repos[n]?.zh).length;
  const tags = tagCounts(home, todayNames);
  const top = home.risers.g7[0];
  const gain = top && home.repos[top]?.g7;
  return html`今天的总榜有 <b>${overall.length}</b> 个项目${fresh
    ? html`，其中 <b>${fresh}</b> 个是第一次登上总榜` : '，没有第一次上榜的项目'}。
    ${tags.length ? html`各榜单已整理解读的 ${explained} 个项目里，<b>${tags[0][0]}</b>（${tags[0][1]}）${tags[1]
      ? html`和 <b>${tags[1][0]}</b>（${tags[1][1]}）` : ''}最多。` : ''}
    ${gain ? html`按本站每日记录，过去 ${gain[1]} 天 Stars 增长最多的是 <a href="${href.repo(top)}">${top}</a>（<b>${fmt.signedCompact(gain[0])}</b>）。` : ''}`;
}

function overallSection(home, state, today) {
  const key = `all:${state.period}`;
  const rows = home.lists[key] || [];
  const cards = rows.map((row) => fromBrief(row.r, home.repos[row.r], row, { listKey: key, period: state.period, today }));
  const periods = Object.keys(PERIODS).map((p) => [p, PERIODS[p], !home.lists[`all:${p}`]]);
  return html`<section class="section" aria-labelledby="overall-title">
    <div class="section-head">
      <h2 id="overall-title">总榜<span class="sub">GitHub Trending 全部语言 · ${PERIODS[state.period]}（GitHub 按${{ daily: '过去 24 小时', weekly: '过去 7 天', monthly: '过去 30 天' }[state.period]}的热度排序）</span></h2>
      <div class="tools">${segmented(periods, state.period, { action: 'period', name: '时间范围' })}
        <a class="more-link" href="${href.day(home.date, { period: state.period })}">完整榜单</a></div>
    </div>
    ${cards.length ? html`<div class="lead-grid">${cards.slice(0, 3).map(storyCard)}</div>
      ${cards.length > 3 ? html`<ol class="rows" style="margin-top:22px" start="4">${cards.slice(3).map((c) => listRow(c))}</ol>` : ''}`
      : html`<p class="state">这一期没有采集到${PERIODS[state.period]}总榜。</p>`}
  </section>`;
}

function riserList(home, metric) {
  const names = home.risers[metric] || [];
  if (!names.length) return html`<p class="foot-note">观测天数还不够，暂时无法计算。</p>`;
  const values = names.map((n) => {
    const b = home.repos[n];
    if (metric === 'rel7') return b.g7[0] / Math.max(1, b.stars - b.g7[0]);
    return b[metric][0];
  });
  const max = Math.max(...values);
  return html`<ol class="mini">${names.slice(0, 10).map((name, i) => {
    const b = home.repos[name];
    const [gain] = metric === 'rel7' ? b.g7 : b[metric];
    const main = metric === 'rel7' ? `+${fmt.percent(values[i], values[i] < 1 ? 1 : 0)}` : fmt.signedCompact(gain);
    return html`<li>
      <span class="i">${i + 1}</span>
      <div class="t">${repoName(name)}<small>${b.zh || b.desc || ''}</small></div>
      <div class="v"><b class="num up">${main}</b><small class="num muted">${metric === 'rel7'
        ? `${fmt.signedCompact(gain)} / 7 天` : `★ ${fmt.compact(b.stars)}`}</small>
        <span class="bar" style="width:${Math.max(4, Math.round((values[i] / max) * 64))}px"></span></div>
    </li>`;
  })}</ol>`;
}

function newcomerSection(home, today) {
  const week = home.first_week || [];
  const listNew = Object.entries(home.list_new || {});
  return html`<section class="section" aria-labelledby="new-title">
    <div class="section-head"><h2 id="new-title">新面孔<span class="sub">本周第一次登上总榜（总榜记录始于 ${getManifest().first}）</span></h2></div>
    ${week.length ? html`<ol class="mini">${week.slice(0, 8).map(([name, first, best]) => {
      const b = home.repos[name] || {};
      return html`<li><span class="i" aria-hidden="true">•</span>
        <div class="t">${repoName(name)}<small>${b.zh || b.desc || ''}</small></div>
        <div class="v"><small class="muted">${first === today ? '今天' : fmt.md(first)} 首次上榜</small><small class="num">最高 #${best}</small></div></li>`;
    })}</ol>` : html`<p class="foot-note">本周还没有第一次登上总榜的项目。</p>`}
    ${listNew.length ? html`<div class="list-new"><h3>今天首次登上分榜<span class="muted" style="font-weight:400">（分榜自 ${getManifest().live_since} 开始记录）</span></h3>
      <ul style="display:grid;gap:6px">${listNew.map(([key, names]) => html`<li><span class="tag">${listLabel(key)}</span><span>
        ${names.slice(0, 4).map((n, j) => html`${j ? '、' : ''}<a href="${href.repo(n)}">${n.split('/')[1]}</a>`)}${names.length > 4 ? ` 等 ${names.length} 个` : ''}</span></li>`)}</ul></div>` : ''}
  </section>`;
}

function risersSection(home, state) {
  return html`<section class="section" aria-labelledby="risers-title">
    <div class="section-head">
      <h2 id="risers-title">涨星最快<span class="sub">本站每日记录的总 Stars 变化，含已离榜的仓库</span></h2>
    </div>
    <div class="section-tools">${segmented(RISER_TABS, state.riser, { action: 'riser', name: '增长口径' })}</div>
    ${riserList(home, state.riser)}
    <p class="foot-note">${state.riser === 'rel7' ? '增幅 = 7 天新增 ÷ 7 天前的总 Stars，只统计当时已有 500 Stars 以上的仓库。' : ''}
      截至 ${home.star_date} 的观测；观测不足所需天数的仓库不参与排名，不做估算。</p>
  </section>`;
}

function languageSection(home, state, today) {
  const keys = getManifest().lists.filter((l) => l.key !== 'all').map((l) => `${l.key}:daily`)
    .filter((k) => home.lists[k]?.length);
  if (!keys.length) return '';
  const key = keys.includes(state.lang) ? state.lang : keys[0];
  const rows = home.lists[key];
  const list = key.split(':')[0];
  return html`<section class="section" aria-labelledby="lang-title">
    <div class="section-head">
      <h2 id="lang-title">分榜热门<span class="sub">中文项目榜和各编程语言的今日榜</span></h2>
      <a class="more-link" href="${href.day(home.date, { list })}">完整${listLabel(key)}榜</a>
    </div>
    <div class="chip-row wrap-desktop" role="group" aria-label="选择分榜">${keys.map((k) => html`
      <button type="button" class="chip" data-action="lang" data-value="${k}" aria-pressed="${k === key}">${listLabel(k)}<span class="count">${home.lists[k].length}</span></button>`)}</div>
    <ol class="rows" style="margin-top:14px">${rows.slice(0, 8).map((row) => listRow(fromBrief(row.r, home.repos[row.r], row, { listKey: key, today }), { compact: true }))}</ol>
    ${rows.length > 8 ? html`<p class="foot-note"><a class="more-link" href="${href.day(home.date, { list })}">还有 ${rows.length - 8} 个项目</a></p>` : ''}
  </section>`;
}

function staying(home) {
  const max = Math.max(1, ...home.sustained.map(([, n]) => n));
  return html`<section class="section" aria-labelledby="stay-title">
    <div class="section-head"><h2 id="stay-title">持续在榜<span class="sub">${fmt.md(home.window_start)} 以来在总榜出现天数最多</span></h2>
      <a class="more-link" href="${href.insights()}?s=evergreen">长期排行</a></div>
    <ol class="mini">${home.sustained.slice(0, 8).map(([name, days], i) => {
      const b = home.repos[name] || {};
      return html`<li><span class="i">${i + 1}</span>
        <div class="t">${repoName(name)}<small>${b.zh || b.desc || ''}</small></div>
        <div class="v"><b class="num">${days} 天</b><span class="bar" style="width:${Math.round((days / max) * 64)}px;background:var(--chart-2)"></span></div></li>`;
    })}</ol>
  </section>`;
}

function categories(home, todayNames) {
  const tags = tagCounts(home, todayNames);
  if (!tags.length) return '';
  return html`<section class="section" aria-labelledby="cat-title">
    <div class="section-head"><h2 id="cat-title">今天的项目都在做什么<span class="sub">按项目解读的分类统计今日各榜单（同一项目只算一次）</span></h2></div>
    <div class="chip-row wrap-desktop">${tags.map(([tag, n]) => html`<a class="chip" href="${href.explore({ cat: tag, seen: 1 })}">${tag}<span class="count">${n}</span></a>`)}</div>
  </section>`;
}

export async function render(root, route, ctx) {
  const home = await loadHome();
  if (!ctx.isCurrent()) return;
  const manifest = getManifest();
  document.title = `${fmt.md(home.date)} · GitHub 热榜日报`;
  const todayNames = [...new Set(Object.values(home.lists).flat().map((r) => r.r))];
  const state = { period: 'daily', riser: 'g7', lang: 'zh:daily' };
  const today = home.date;

  const parts = {
    period: () => overallSection(home, state, today),
    riser: () => risersSection(home, state),
    lang: () => languageSection(home, state, today),
  };
  paint(root, html`<div class="view-home fade-in">
    <header class="masthead">
      <p class="eyebrow"><span class="live">每日更新</span><span>${fmt.longDate(home.date)} · ${fmt.weekday(home.date)}</span>
        ${home.captured_at ? html`<span>榜单采集于 ${fmt.beijing(home.captured_at)}（北京时间）</span>` : ''}</p>
      <h1 class="page-title">今天值得关注的开源项目</h1>
      <p class="lede">${lede(home, todayNames)}</p>
      ${home.stale ? notice('这一期的总榜与上一期完全相同，疑似 GitHub 端没有更新。照常展示，但不计入上榜天数和连续天数。', 'warn') : ''}
      ${home.errors?.length ? notice(`以下榜单本期采集失败：${home.errors.map(listLabel).join('、')}。`, 'warn') : ''}
      <div class="kpis">
        <div class="kpi"><b>${(home.lists['all:daily'] || []).length}</b><span>今日总榜项目</span></div>
        <div class="kpi"><b>${home.newcomers.length}</b><span>第一次登上总榜</span></div>
        <div class="kpi"><b>${todayNames.length}</b><span>今日各榜单项目（去重）</span></div>
        <div class="kpi"><b>${fmt.int(manifest.counts.tracked)}</b><span>每天记录总 Stars 的仓库</span></div>
      </div>
    </header>
    <div data-part="period">${parts.period()}</div>
    <div class="cols two"><div data-part="riser">${parts.riser()}</div>${newcomerSection(home, today)}</div>
    <div data-part="lang">${parts.lang()}</div>
    <div class="cols two">${staying(home)}${categories(home, todayNames)}</div>
  </div>`);

  const onClick = (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button || !parts[button.dataset.action]) return;
    const { action, value } = button.dataset;
    state[action] = value;
    const holder = root.querySelector(`[data-part="${action}"]`);
    paint(holder, parts[action]());
    holder.querySelector(`button[data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
