// 趋势: what three years of the overall daily list say about the open-source attention economy.
import { html, raw, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadInsights } from '../data.js';
import { lineChart, columnChart, miniLine } from '../charts.js';
import { LANG_COLORS, avatar, repoName, segmented } from '../ui.js';

const WINDOWS = [['30', '近 30 天'], ['90', '近 90 天'], ['365', '近 1 年'], ['0', '全部']];
const monthTick = (m) => `${m.slice(2, 4)}.${m.slice(5)}`;

function multiples(data) {
  const entries = Object.entries(data.lang);
  const max = Math.max(...entries.flatMap(([, v]) => v));
  const n = data.months.length;
  return html`<div class="multiples">${entries.map(([lang, values]) => {
    const now = values[n - 1];
    const before = n > 12 ? values[n - 13] : null;
    const diff = before == null ? null : Math.round((now - before) * 10) / 10;
    const color = lang === '其他' ? 'var(--chart-muted)' : LANG_COLORS[lang] || 'var(--ink-3)';
    return html`<div class="multiple" style="--c:${color}">
      <span class="k"><span class="lang"><i></i>${lang}</span><span class="v">${now}%</span></span>
      ${raw(miniLine(values, max))}
      <small>${diff == null ? '' : `比一年前 ${diff > 0 ? '+' : ''}${diff} 个百分点`}</small>
    </div>`;
  })}</div>`;
}

function evergreen(data, win) {
  const rows = data.evergreen[win] || [];
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return html`<ol class="mini">${rows.map(([name, days, best, zh], i) => html`<li>
    <span class="i">${i + 1}</span>
    <div class="t">${repoName(name)}<small>${zh || ''}</small></div>
    <div class="v"><b class="num">${days} 天</b><small class="num muted">最好 #${best}</small>
      <span class="bar" style="width:${Math.round((days / max) * 64)}px;background:var(--chart-2)"></span></div></li>`)}</ol>`;
}

export async function render(root, route, ctx) {
  const data = await loadInsights();
  if (!ctx.isCurrent()) return;
  const m = getManifest();
  document.title = '趋势 · GitHub 热榜日报';
  const state = { win: '90' };
  const months = data.months;
  const tmax = Math.max(1, ...data.topics.map((t) => Math.max(t.n, t.prev)));
  const catTotal = data.categories.reduce((s, [, n]) => s + n, 0);
  const cmax = Math.max(1, ...data.categories.map(([, n]) => n));
  const validDays = m.counts.days - m.stale.length;

  paint(root, html`<div class="view-insights fade-in">
    <header class="masthead">
      <p class="eyebrow"><span>${m.first} 至 ${m.latest}</span><span>${fmt.int(m.counts.days)} 天总榜记录</span></p>
      <h1 class="page-title">开源注意力的走向</h1>
      <p class="lede">这里的统计都来自 GitHub Trending 总榜“今日”榜：${fmt.int(validDays)} 个有效采集日（另有 ${m.stale.length} 天与前一天完全相同，疑似未更新，已排除）。
        它反映的是 GitHub 上短期关注度的变化，不等于项目质量或使用量。</p>
      <div class="kpis">
        <div class="kpi"><b>${fmt.int(data.kpi.overall_repos)}</b><span>上过总榜的项目</span></div>
        <div class="kpi"><b>${data.kpi.new_per_day_30}</b><span>近 30 个采集日平均每天的新面孔</span></div>
        <div class="kpi"><b>${data.kpi.size_30}</b><span>近 30 个采集日总榜平均项目数</span></div>
        <div class="kpi"><b>${fmt.int(m.counts.tracked)}</b><span>每天记录总 Stars 的仓库</span></div>
      </div>
    </header>

    <section class="section" aria-labelledby="ai-title">
      <div class="section-head"><h2 id="ai-title">AI 相关项目占比<span class="sub">每月总榜条目中，名称、简介、话题或分类与 AI 相关的比例</span></h2></div>
      <div class="chart" id="c-ai"></div>
      <p class="foot-note">按关键词（如 llm、agent、mcp、claude、diffusion）和中文解读的 AI 分类判断，属于估计，适合看趋势，不适合精确比较。${months[months.length - 1]} 为本月至今。</p>
    </section>

    <section class="section" aria-labelledby="lang-title">
      <div class="section-head"><h2 id="lang-title">编程语言格局<span class="sub">每月总榜条目的主要语言占比；各小图纵轴相同，可以直接比较高低</span></h2></div>
      ${multiples(data)}
      <p class="foot-note">“无主语言”多为教程、资料清单类仓库。语言取自 GitHub 的仓库主要语言。</p>
    </section>

    <div class="insight-grid two">
      <section class="section" aria-labelledby="newcomer-title">
        <div class="section-head"><h2 id="newcomer-title">每月新面孔<span class="sub">第一次登上总榜的项目数</span></h2></div>
        <div class="chart" id="c-new"></div>
        <p class="foot-note">归档从 ${m.first} 开始，因此不显示 ${months[0]}；最初几个月的数字会偏高（更早上过榜的项目也被算作新面孔）。最后一个月为本月至今。</p>
      </section>
      <section class="section" aria-labelledby="size-title">
        <div class="section-head"><h2 id="size-title">总榜每天有多少项目<span class="sub">每月平均</span></h2></div>
        <div class="chart" id="c-size"></div>
        <p class="foot-note">GitHub 在 2024 年中开始缩短 Trending 列表，所以“上榜天数”在不同时期的难度并不完全相同。</p>
      </section>
    </div>

    <div class="insight-grid two">
      <section class="section" aria-labelledby="topic-title">
        <div class="section-head"><h2 id="topic-title">近 30 个采集日的热门话题<span class="sub">上榜项目的 GitHub topics 出现次数（项目 × 天），灰色为前 30 个采集日</span></h2></div>
        <ul class="topic-rows">${data.topics.slice(0, 15).map((t) => html`<li>
          <a class="topic" href="${href.explore({ q: t.t })}" style="font-size:14px;color:var(--ink)">${t.t}</a>
          <span class="num">${t.n} <span class="${t.n >= t.prev ? 'up' : 'muted'}" style="font-size:12px">${t.prev ? `${t.n >= t.prev ? '↑' : '↓'} ${t.prev}` : '新'}</span></span>
          <span class="bar-wrap"><i style="width:${(100 * t.n) / tmax}%"></i></span></li>`)}</ul>
      </section>
      <section class="section" aria-labelledby="cat-title">
        <div class="section-head"><h2 id="cat-title">近 30 天上榜项目的分类<span class="sub">${data.categories_window.from} 以来出现在任一榜单的 ${fmt.int(data.categories_window.repos)} 个项目中，有中文解读的 ${fmt.int(data.categories_window.explained)} 个</span></h2></div>
        <ul class="topic-rows">${data.categories.slice().sort((a, b) => b[1] - a[1]).map(([tag, n]) => html`<li>
          <a href="${href.explore({ cat: tag, seen: 30 })}" style="font-size:14px">${tag}</a>
          <span class="num">${n} <span class="muted" style="font-size:12px">${fmt.percent(n / Math.max(1, data.categories_window.explained))}</span></span>
          <span class="bar-wrap"><i style="width:${(100 * n) / cmax}%;background:var(--chart-1)"></i></span></li>`)}</ul>
        <p class="foot-note">一个项目最多有两个分类，所以合计（${catTotal}）会大于项目数。</p>
      </section>
    </div>

    <section class="section" id="evergreen" aria-labelledby="ever-title">
      <div class="section-head"><h2 id="ever-title">长青项目<span class="sub">在总榜出现天数最多的项目</span></h2>
        <div class="tools" data-part="win">${segmented(WINDOWS, state.win, { action: 'win', name: '统计范围' })}</div></div>
      <div data-part="ever">${evergreen(data, state.win)}</div>
    </section>

    <section class="section" aria-labelledby="owner-title">
      <div class="section-head"><h2 id="owner-title">上榜项目最多的作者与组织<span class="sub">上过总榜的不同项目数 · 累计上榜天数</span></h2></div>
      <ol class="mini">${data.owners.slice(0, 12).map((o, i) => html`<li>
        <span class="i">${i + 1}</span>
        <div class="t"><a class="repo-name" href="https://github.com/${o.o}" target="_blank" rel="noopener">${avatar(`${o.o}/x`)}<span class="label">${o.o}</span></a>
          <small>${o.top.map((n, j) => html`${j ? '、' : ''}<a href="${href.repo(n)}" style="position:relative;z-index:1">${n.split('/')[1]}</a>`)}</small></div>
        <div class="v"><b class="num">${o.repos} 个</b><small class="num muted">${o.days} 天</small></div></li>`)}</ol>
    </section>
  </div>`);

  lineChart(root.querySelector('#c-ai'), {
    labels: months, series: [{ name: 'AI 相关', values: data.ai }], format: (v) => `${v}%`, tickFormat: (v) => `${v}%`,
    labelFormat: monthTick, tipLabel: fmt.yearMonth, max: 100, label: 'AI 相关项目占比（按月）',
  });
  const newMonths = months.slice(1);
  columnChart(root.querySelector('#c-new'), {
    labels: newMonths, values: data.newcomers.slice(1), labelFormat: monthTick, tipLabel: fmt.yearMonth,
    format: (v) => fmt.int(v), dim: (i) => i === newMonths.length - 1, label: '每月第一次登上总榜的项目数',
  });
  lineChart(root.querySelector('#c-size'), {
    labels: months, series: [{ name: '平均项目数', values: data.size, color: 'var(--chart-2)' }], format: (v) => `${v} 个`,
    tickFormat: (v) => `${v}`, labelFormat: monthTick, tipLabel: fmt.yearMonth, label: '总榜每天平均项目数（按月）',
  });

  const onClick = (e) => {
    const button = e.target.closest('button[data-action="win"]');
    if (!button) return;
    state.win = button.dataset.value;
    paint(root.querySelector('[data-part="win"]'), segmented(WINDOWS, state.win, { action: 'win', name: '统计范围' }));
    paint(root.querySelector('[data-part="ever"]'), evergreen(data, state.win));
    root.querySelector(`button[data-action="win"][data-value="${state.win}"]`)?.focus({ preventScroll: true });
  };
  root.addEventListener('click', onClick);
  if (route.query.get('s') === 'evergreen') requestAnimationFrame(() => root.querySelector('#evergreen')?.scrollIntoView());
  return () => root.removeEventListener('click', onClick);
}
