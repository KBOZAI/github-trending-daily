// 榜单: any day's lists since 2023-09-09, with rank changes, days on list and the period's gain.
import { html, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadCatalog, loadDay, listLabel, PERIODS } from '../data.js';
import { notice } from '../ui.js';
import { listRow } from './cards.js';

const SORTS = [['rank', 'Trending 排名'], ['stars', '总 Stars'], ['gain', '期间新增 Stars']];

function nearestDate(dates, wanted) {
  let pick = dates[0];
  for (const d of dates) { if (d <= wanted) pick = d; else break; }
  return pick;
}

export async function render(root, route, ctx) {
  const m = getManifest();
  const dates = m.dateList;
  const requested = route.date;
  const date = requested && m.dateSet.has(requested) ? requested : requested ? nearestDate(dates, requested) : m.latest;
  const day = await loadDay(date);
  // Archive days carry ranks only; today's totals come from the catalog and are labelled as current.
  const catalog = day.src === 'live' ? null : await loadCatalog().catch(() => null);
  if (!ctx.isCurrent()) return;
  const current = (name) => catalog?.byName.get(name.toLowerCase())?.stars ?? null;

  let list = route.query.get('list') || 'all';
  let period = route.query.get('period') || 'daily';
  if (!day.lists[`${list}:${period}`]) {
    if (day.lists[`${list}:daily`]) period = 'daily';
    else { list = 'all'; period = 'daily'; }
  }
  const key = `${list}:${period}`;
  const sort = SORTS.some(([s]) => s === route.query.get('sort')) ? route.query.get('sort') : 'rank';
  const tag = route.query.get('tag') || '';
  const rows = day.lists[key] || [];
  const spec = m.lists.find((l) => l.key === list);
  const index = dates.indexOf(date);
  const prev = dates[index - 1];
  const next = dates[index + 1];
  const live = day.src === 'live';
  document.title = `${listLabel(key)} · ${date} · GitHub 热榜日报`;

  const tagCounts = new Map();
  rows.forEach((r) => (day.repos[r.r]?.tags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  let shown = tag ? rows.filter((r) => day.repos[r.r]?.tags?.includes(tag)) : [...rows];
  const total = (r) => r.s ?? current(r.r) ?? -1;
  if (sort === 'stars') shown.sort((a, b) => total(b) - total(a) || a.k - b.k);
  if (sort === 'gain') shown.sort((a, b) => (b.g ?? -1) - (a.g ?? -1) || a.k - b.k);
  const fresh = rows.filter((r) => r.new).length;

  const listChip = (l) => {
    const k = `${l.key}:${l.key === list ? period : 'daily'}`;
    const available = day.lists[`${l.key}:daily`] || day.lists[k];
    const n = day.lists[`${l.key}:daily`]?.length;
    return html`<a class="chip ${available ? '' : 'dim'}" href="${href.day(date, { list: l.key, period: l.key === list ? period : 'daily' })}"
      aria-current="${l.key === list}" ${available ? '' : html`title="这一天没有${l.name}数据（分榜从 ${m.live_since} 开始采集）"`}>${l.name}${n ? html`<span class="count">${n}</span>` : ''}</a>`;
  };
  const cards = shown.map((r) => {
    const info = day.repos[r.r] || {};
    return {
      name: r.r, rank: r.k, row: r, listKey: key, period, zh: info.zh, desc: info.desc, tags: info.tags, lang: info.lang,
      gone: Boolean(info.gone), stars: live ? r.s : current(r.r), starsLabel: live ? '采集时总 Stars' : '当前总 Stars',
      trending: live ? r.g : null, days: r.d, streak: r.st,
    };
  });

  const view = html`<div class="view-day fade-in">
    <header>
      <p class="eyebrow"><span>GitHub Trending 榜单存档</span><span>${fmt.int(dates.length)} 天 · ${m.first} 起</span></p>
      <h1 class="page-title">${fmt.longDate(date)} <span class="muted" style="font-size:.5em;font-weight:500">${fmt.weekday(date)}</span></h1>
      <div class="day-nav">
        <a class="btn icon" href="${prev ? href.day(prev, { list, period }) : '#'}" aria-label="前一天" ${prev ? '' : html`aria-disabled="true"`}>‹</a>
        <input type="date" id="day-picker" value="${date}" min="${dates[0]}" max="${m.latest}" aria-label="选择日期">
        <a class="btn icon" href="${next ? href.day(next, { list, period }) : '#'}" aria-label="后一天" ${next ? '' : html`aria-disabled="true"`}>›</a>
        ${date !== m.latest ? html`<a class="btn" href="${href.day(m.latest, { list, period })}">回到最新</a>` : ''}
        <span class="badge badge-muted" title="${live ? '本站当天抓取的 GitHub Trending 页面' : '来自公开归档，只记录了排名顺序'}">${live ? '实时采集' : '历史归档'}</span>
      </div>
    </header>
    ${requested && requested !== date ? notice(`${requested} 没有榜单数据，已显示此前最近的 ${date}。`) : ''}
    <div class="list-switch">
      <div class="chip-row wrap-desktop" role="group" aria-label="选择榜单">${m.lists.map(listChip)}</div>
      ${spec && spec.periods.length > 1 ? html`<div class="seg" role="group" aria-label="时间范围">${spec.periods.map((p) => html`
        <a href="${href.day(date, { list, period: p })}" aria-current="${p === period}" ${day.lists[`${list}:${p}`] ? '' : html`aria-disabled="true" class="dim"`}>${PERIODS[p]}</a>`)}</div>` : ''}
    </div>
    ${day.stale ? notice('这一天的总榜与上一期完全相同，疑似 GitHub 端没有更新（例如 2025-11-13 至 12-04 的冻结）。照常展示，但不计入上榜天数和连续天数。', 'warn') : ''}
    ${!live ? notice(`这一天来自 antonkomarev/github-trending-archive 归档，只记录了总榜排名。显示的中文解读、语言和 ★ 总 Stars 都是现在的数据，不是当天的数值。`) : ''}
    ${day.errors?.includes(key) ? notice('这个榜单当天采集失败。', 'warn') : ''}
    <div class="toolbar">
      <div class="left"><span><b class="num" style="color:var(--ink)">${rows.length}</b> 个项目</span>
        ${list === 'all' && period === 'daily' && date > m.first ? html`<span>首次上榜 <b class="num" style="color:var(--ink)">${fresh}</b></span>` : ''}
        ${day.captured_at ? html`<span>采集于 ${fmt.beijing(day.captured_at)}（北京时间）</span>` : ''}</div>
      <label>排序 <select class="select" id="day-sort" aria-label="排序方式">${SORTS.map(([value, label]) => html`
        <option value="${value}" ${value === sort ? 'selected' : ''} ${value !== 'rank' && !live && value === 'gain' ? 'disabled' : ''}>${label}</option>`)}</select></label>
    </div>
    ${tagCounts.size > 1 ? html`<div class="chip-row wrap-desktop" role="group" aria-label="按分类筛选" style="margin-bottom:6px">
      <a class="chip" href="${href.day(date, { list, period, sort })}" aria-current="${!tag}">全部<span class="count">${rows.length}</span></a>
      ${[...tagCounts].sort((a, b) => b[1] - a[1]).map(([t, n]) => html`<a class="chip" href="${href.day(date, { list, period, sort, tag: t })}" aria-current="${t === tag}">${t}<span class="count">${n}</span></a>`)}
    </div>` : ''}
    ${cards.length ? html`<ol class="rows">${cards.map((c) => listRow(c))}</ol>`
      : html`<p class="state">${rows.length ? '这个分类下没有项目。' : '这一天没有这个榜单的数据。'}</p>`}
    <p class="foot-note">名次旁的 ▲▼ 是与上一期（上一个有效采集日）相比的变化；“在榜”按有效采集日累计，疑似未更新的日子不计。
      ${live ? html`“Trending ${PERIODS[period]}”是 GitHub 页面显示的期间新增 Stars，与本站自己记录的总 Stars 增长不是同一口径。` : ''}</p>
  </div>`;
  paint(root, view);

  const picker = root.querySelector('#day-picker');
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    location.hash = href.day(nearestDate(dates, picker.value), { list, period });
  });
  root.querySelector('#day-sort').addEventListener('change', (e) => {
    location.hash = href.day(date, { list, period, sort: e.target.value, tag });
  });
  const onKey = (e) => {
    if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const to = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
    if (to) location.hash = href.day(to, { list, period, sort, tag });
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
