// 项目档案: what a project is for, how its total Stars changed since tracking began, and its list history.
import { html, render as paint, safeUrl } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest, loadRepo, loadStars, listLabel, PERIODS } from '../data.js';
import { starChart, rankChart } from '../charts.js';
import { avatar, compareButton, langDot, repoName, segmented, topicChip, tagChip } from '../ui.js';

const EXTERNAL = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/></svg>`;

/** Same rule as dataset.growth(): baseline between window and window+tolerance days earlier, else unknown. */
export function growth(points, window, tolerance = 2) {
  if (points.length < 2) return null;
  const [lastDate, lastValue] = points[points.length - 1];
  const newest = fmt.addDays(lastDate, -window);
  const oldest = fmt.addDays(lastDate, -window - tolerance);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const [date, value] = points[i];
    if (date <= newest) return date < oldest ? null : { gain: lastValue - value, from: date, to: lastDate, span: fmt.daysBetween(date, lastDate) };
  }
  return null;
}

function statusBadges(record, latest) {
  const out = [];
  const lists = Object.entries(record.lists || {});
  if (lists.some(([, l]) => l.last === latest)) out.push(html`<span class="badge badge-new">今日在榜</span>`);
  const overall = record.lists?.['all:daily'];
  if (overall?.first === latest) out.push(html`<span class="badge badge-back">今天第一次登上总榜</span>`);
  if (record.meta.archived) out.push(html`<span class="badge badge-gone">仓库已归档</span>`);
  if (record.meta.gone) out.push(html`<span class="badge badge-gone">已删除或转为私有</span>`);
  if (record.meta.fork) out.push(html`<span class="badge badge-muted">Fork 仓库</span>`);
  return out;
}

function explanation(record) {
  const intro = record.intro;
  const name = record.name;
  if (!intro) {
    return html`<section class="panel explain" aria-labelledby="explain-title">
      <h2 class="panel-title" id="explain-title">这个项目是做什么的</h2>
      <p class="what">${record.meta.desc || '项目没有提供简介。'}</p>
      <p class="source-line">暂无中文解读，上面是项目自己的英文简介。中文解读会按上榜情况陆续补充，也可以直接
        <a href="https://github.com/${name}#readme" target="_blank" rel="noopener">阅读 README ↗</a>。</p>
    </section>`;
  }
  const source = safeUrl(intro.source?.url) || `https://github.com/${name}`;
  const kind = intro.source?.kind === 'repository' ? '仓库公开说明' : 'README';
  return html`<section class="panel explain" aria-labelledby="explain-title">
    <h2 class="panel-title" id="explain-title">这个项目是做什么的</h2>
    <p class="what">${intro.what || intro.zh}</p>
    <div class="explain-grid">
      ${intro.use_cases?.length ? html`<div><h3>可以用来</h3><ol class="uses">${intro.use_cases.map((u) => html`<li>${u}</li>`)}</ol></div>` : ''}
      <div style="display:grid;gap:18px;align-content:start">
        ${intro.audience ? html`<div><h3>适合谁</h3><p>${intro.audience}</p></div>` : ''}
        ${intro.features?.length ? html`<div><h3>主要能力</h3><ul class="plain-list">${intro.features.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
        ${intro.notes?.length ? html`<div><h3>上手前须知</h3><ul class="plain-list">${intro.notes.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
        ${intro.tags?.length ? html`<div><h3>分类</h3><div class="topics">${intro.tags.map(tagChip)}</div></div>` : ''}
      </div>
    </div>
    <p class="source-line">依据项目公开资料整理：<a href="${source}" target="_blank" rel="noopener">${kind}</a>${intro.date ? `，${intro.date} 整理` : ''}。
      由 AI 辅助撰写，只写资料里有依据的内容，宣传性说法未经本站验证；如有出入，以原始资料为准。</p>
  </section>`;
}

function facts(record, latest) {
  const m = record.meta;
  const homepage = safeUrl(m.homepage);
  const rows = [
    m.lang && ['主要语言', langDot(m.lang)],
    m.license && m.license !== 'NOASSERTION' && ['许可证', m.license],
    m.license === 'NOASSERTION' && ['许可证', '自定义或无法识别'],
    m.created && ['创建时间', html`${m.created} <span class="muted">（${fmt.age(m.created, latest)}）</span>`],
    m.pushed && ['最近推送', html`${m.pushed} <span class="muted">（${fmt.ago(m.pushed, latest)}）</span>`],
    m.release && ['最新版本', html`${m.release.tag}${m.release.date ? html` <span class="muted">（${m.release.date}）</span>` : ''}`],
    m.forks != null && ['Fork', html`<span class="num">${fmt.int(m.forks)}</span>`],
    m.issues != null && ['开放 Issue', html`<span class="num">${fmt.int(m.issues)}</span>`],
    homepage && ['项目主页', html`<a href="${homepage}" target="_blank" rel="noopener">${homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>`],
    m.fetched && ['元信息更新', m.fetched],
  ].filter(Boolean);
  return html`<section class="panel" aria-labelledby="facts-title">
    <h2 class="panel-title" id="facts-title">基本信息</h2>
    <dl class="facts" style="margin:12px 0 0">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    ${m.topics?.length ? html`<div class="topics" style="margin-top:14px">${m.topics.map(topicChip)}</div>` : ''}
    ${record.aliases?.length ? html`<p class="foot-note">曾用名：${record.aliases.join('、')}</p>` : ''}
  </section>`;
}

function related(record) {
  if (!record.related?.length) return '';
  return html`<section class="panel" aria-labelledby="related-title">
    <h2 class="panel-title" id="related-title">相关项目</h2>
    <p class="panel-sub">话题、分类相近且有中文解读的项目</p>
    <ul class="mini">${record.related.map(([name, zh, lang]) => html`<li style="grid-template-columns:minmax(0,1fr)">
      <div class="t">${repoName(name)}<small>${zh || ''}${lang ? ` · ${lang}` : ''}</small></div></li>`)}</ul>
  </section>`;
}

function tiles(record, points, latest) {
  const last = points[points.length - 1];
  const g7 = growth(points, 7);
  const first = points[0];
  const overall = record.lists?.['all:daily'];
  const lists = Object.entries(record.lists || {});
  const lastSeen = lists.reduce((best, [key, l]) => (!best || l.last > best[1].last ? [key, l] : best), null);
  return html`<div class="stat-tiles">
    <div class="tile"><span class="k">总 Stars <span class="src">记录值</span></span>
      <span class="v star">${last ? fmt.int(last[1]) : '–'}</span>
      <small>${last ? `${last[0]} 记录（UTC）` : '本站暂无观测'}</small></div>
    <div class="tile"><span class="k">近 7 天新增 <span class="src">本站观测</span></span>
      ${g7 ? html`<span class="v up">${fmt.signed(g7.gain)}</span><small>${fmt.shortDate(g7.from)} → ${fmt.shortDate(g7.to)}${g7.span !== 7 ? `（${g7.span} 天）` : ''}</small>`
        : points.length > 1 ? html`<span class="v up">${fmt.signed(last[1] - first[1])}</span><small>观测不足 7 天：${fmt.shortDate(first[0])} 以来</small>`
          : html`<span class="v">–</span><small>需要至少两次观测</small>`}</div>
    <div class="tile"><span class="k">总榜上榜 <span class="src">排名</span></span>
      ${overall ? html`<span class="v">${overall.n} 天</span><small>最好第 ${overall.best} 名 · ${overall.first} 首次</small>`
        : html`<span class="v">0 天</span><small>${lists.length ? `只上过分榜（${lists.map(([k]) => listLabel(k)).join('、')}）` : '没有上榜记录'}</small>`}</div>
    <div class="tile"><span class="k">最近上榜</span>
      ${lastSeen ? html`<span class="v" style="font-size:20px">${fmt.ago(lastSeen[1].last, latest)}</span><small>${lastSeen[1].last} · ${listLabel(lastSeen[0])}</small>`
        : html`<span class="v">–</span><small>没有上榜记录</small>`}</div>
  </div>`;
}

const STAR_RANGES = [['14', '近 14 天'], ['30', '近 30 天'], ['90', '近 90 天'], ['all', '全部记录']];
const RANK_RANGES = [['90', '近 90 天'], ['365', '近 1 年'], ['all', '全部']];

function starRange(points, key) {
  const last = points[points.length - 1][0];
  if (key === 'all') return [points[0][0], last];
  return [fmt.addDays(last, -(Number(key) - 1)), last];
}

function starTable(points) {
  return html`<details class="data-table"><summary>查看全部 ${points.length} 条记录</summary>
    <div class="table-scroll"><table class="list-table"><thead><tr><th>日期（UTC）</th><th class="n">总 Stars</th><th class="n">较上次观测</th></tr></thead>
    <tbody>${points.slice().reverse().map(([d, v], i, all) => {
      const prev = all[i + 1];
      const gap = prev ? fmt.daysBetween(prev[0], d) : 0;
      return html`<tr><td>${d}</td><td class="n">${fmt.int(v)}</td><td class="n">${prev ? html`${fmt.signed(v - prev[1])}${gap > 1 ? html` <span class="muted">/${gap} 天</span>` : ''}` : html`<span class="muted">首次</span>`}</td></tr>`;
    })}</tbody></table></div></details>`;
}

function listTable(record, latest) {
  const entries = Object.entries(record.lists || {});
  if (!entries.length) return '';
  const order = getManifest().listKeys;
  entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return html`<div class="table-scroll" style="margin-top:16px"><table class="list-table">
    <thead><tr><th>榜单</th><th class="n">上榜天数</th><th class="n">最好名次</th><th>首次</th><th>最近</th><th class="n">当前连续</th></tr></thead>
    <tbody>${entries.map(([key, l]) => html`<tr><td><a href="${href.day(l.last, { list: key.split(':')[0], period: key.split(':')[1] })}">${listLabel(key)}</a></td>
      <td class="n">${l.n}</td><td class="n">#${l.best}</td><td>${l.first}</td><td>${l.last === latest ? '今天' : l.last}</td><td class="n">${l.streak || '–'}</td></tr>`)}</tbody>
  </table></div>`;
}

export async function render(root, route, ctx) {
  const m = getManifest();
  const latest = m.latest;
  let record = await loadRepo(route.name);
  if (!ctx.isCurrent()) return;
  if (record?.redirect) {
    history.replaceState(null, '', href.repo(record.redirect));
    record = await loadRepo(record.redirect);
    if (!ctx.isCurrent()) return;
  }
  if (!record) {
    document.title = `${route.name} · GitHub 热榜日报`;
    paint(root, html`<div class="state fade-in"><h2>没有 ${route.name} 的记录</h2>
      <p>这个仓库没有出现在本站收录的榜单里，或者名字有变化。</p>
      <a class="btn" href="https://github.com/${route.name}" target="_blank" rel="noopener">在 GitHub 查看 ↗</a>
      <a class="btn" href="${href.explore({ q: route.name.split('/')[1] || route.name })}">在项目库搜索</a></div>`);
    return;
  }
  const name = record.name;
  if (route.name !== name) history.replaceState(null, '', href.repo(name));
  const [owner, repo] = name.split('/');
  document.title = `${name}${record.intro?.zh ? ` · ${record.intro.zh}` : ''} · GitHub 热榜日报`;

  let points = [];
  let starsError = null;
  try {
    points = await loadStars(name);
  } catch (error) {
    starsError = error;
  }
  if (!ctx.isCurrent()) return;

  const listKeys = Object.keys(record.lists || {}).sort((a, b) => m.listKeys.indexOf(a) - m.listKeys.indexOf(b));
  const markers = [...new Set(Object.entries(record.lists || {})
    .filter(([k]) => k.endsWith(':daily')).flatMap(([, l]) => l.h.map((h) => h[0])))].sort();
  const lastPoint = points[points.length - 1];
  const spanDays = points.length ? fmt.daysBetween(points[0][0], lastPoint[0]) : 0;
  const state = { stars: spanDays > 120 ? '90' : 'all', rankList: listKeys[0], rank: 'all' };
  const sinceStart = points.length > 1 ? lastPoint[1] - points[0][1] : null;

  paint(root, html`<article class="view-repo fade-in">
    <nav class="crumbs" aria-label="位置"><a href="${href.home()}" data-action="back">← 返回</a><a href="${href.explore()}">项目库</a></nav>
    <header class="dossier-head">
      ${avatar(name, 'lg')}
      <div>
        <p class="eyebrow">项目档案${record.meta.lang ? html` · ${record.meta.lang}` : ''}</p>
        <h1><span class="owner">${owner} /</span> ${repo}</h1>
        <div class="badges">${statusBadges(record, latest)}</div>
        ${record.intro?.zh ? html`<p class="zh">${record.intro.zh}</p>` : ''}
        ${record.meta.desc ? html`<p class="desc"><span class="k">原文简介</span>${record.meta.desc}</p>` : ''}
        <div class="actions">
          <a class="btn primary" href="https://github.com/${name}" target="_blank" rel="noopener">在 GitHub 打开 ${EXTERNAL}</a>
          ${safeUrl(record.meta.homepage) ? html`<a class="btn" href="${safeUrl(record.meta.homepage)}" target="_blank" rel="noopener">项目主页 ${EXTERNAL}</a>` : ''}
          ${compareButton(name)}
        </div>
      </div>
    </header>
    ${tiles(record, points, latest)}
    <div class="dossier-grid">
      <div class="dossier-main">
        ${explanation(record)}
        <section class="panel" aria-labelledby="stars-title">
          <div class="chart-head">
            <div><h2 class="panel-title" id="stars-title">总 Stars 记录</h2>
              <p class="panel-sub" style="margin:0">本站从 ${points[0]?.[0] ?? m.stars.since} 开始每天记录这个仓库；更早的历史不在本站数据范围内，不做推算。</p></div>
            <div data-part="star-range">${points.length ? segmented(STAR_RANGES, state.stars, { action: 'star-range', name: '时间范围' }) : ''}</div>
          </div>
          ${points.length ? html`
            <div class="chart-legend"><span><i style="--c:var(--chart-1)"></i>总 Stars（点 = 实际记录）</span><span><i class="gap"></i>无观测</span>
              <span><i style="--c:var(--up)"></i>每日新增</span>${markers.length ? html`<span><i style="--c:var(--accent)"></i>当天在日榜上</span>` : ''}</div>
            <div class="chart" id="star-chart"></div>
            <p class="chart-caption">${points.length} 个观测日（${points[0][0]} 至 ${lastPoint[0]}）${sinceStart != null
              ? html`，记录以来 <b class="num" style="color:var(--up)">${fmt.signed(sinceStart)}</b>${points[0][1] > 0 ? `（${sinceStart >= 0 ? '+' : ''}${fmt.percent(sinceStart / points[0][1], 1)}）` : ''}` : ''}。
              ${points.length === 1 ? '目前只有一次观测，获得第二次记录后才能看到变化。' : '相邻两天都有记录时才计算每日新增；Stars 可能减少，曲线保留真实升降。'}</p>
            ${starTable(points)}`
            : html`<div class="chart-empty">${starsError ? `Stars 记录加载失败：${starsError.message}` : '本站还没有这个仓库的 Stars 观测（已删除、转为私有，或在开始记录前就已离榜）。'}</div>`}
        </section>
        <section class="panel" aria-labelledby="rank-title">
          <div class="chart-head">
            <div><h2 class="panel-title" id="rank-title">上榜记录</h2>
              <p class="panel-sub" style="margin:0">总榜排名自 ${m.first} 起（早期来自公开归档）；中文和各语言分榜自 ${m.live_since} 起。</p></div>
            ${listKeys.length ? html`<div data-part="rank-range">${segmented(RANK_RANGES, state.rank, { action: 'rank-range', name: '时间范围' })}</div>` : ''}
          </div>
          ${listKeys.length ? html`
            ${listKeys.length > 1 ? html`<div class="chip-row" role="group" aria-label="选择榜单" style="margin-bottom:10px">${listKeys.map((k) => html`
              <button type="button" class="chip" data-action="rank-list" data-value="${k}" aria-pressed="${k === state.rankList}">${listLabel(k)}<span class="count">${record.lists[k].n}</span></button>`)}</div>` : ''}
            <div class="chart" id="rank-chart"></div>
            ${listTable(record, latest)}`
            : html`<div class="chart-empty">这个仓库还没有出现在本站收录的榜单里。</div>`}
        </section>
      </div>
      <aside class="dossier-side">
        ${facts(record, latest)}
        ${related(record)}
        <section class="panel">
          <h2 class="panel-title">数据口径</h2>
          <ul class="plain-list" style="font-size:13.5px;margin-top:8px">
            <li><b>总 Stars</b>：本站每天通过 GitHub API 记录的实际数值。</li>
            <li><b>近 7 天新增</b>：两次记录之差，只在有对应日期的记录时计算。</li>
            <li><b>Trending 新增</b>：GitHub Trending 页面在采集时显示的期间新增，属于 GitHub 的口径。</li>
            <li><b>名次</b>：当天 Trending 页面上的顺序。</li>
          </ul>
          <p class="foot-note"><a class="more-link" href="${href.about('metrics')}">完整说明</a></p>
        </section>
      </aside>
    </div>
  </article>`);

  const drawStars = () => {
    const el = root.querySelector('#star-chart');
    if (el && points.length) starChart(el, points, { range: starRange(points, state.stars), markers, label: `${name} 总 Stars 记录` });
  };
  const drawRanks = () => {
    const el = root.querySelector('#rank-chart');
    const list = record.lists?.[state.rankList];
    if (!el || !list) return;
    const first = list.h[0][0];
    const from = state.rank === 'all' ? fmt.addDays(first, -2) : fmt.addDays(latest, -(Number(state.rank) - 1));
    const period = PERIODS[state.rankList.split(':')[1]];
    rankChart(el, list.h, { range: [from < first && state.rank === 'all' ? from : from, latest], period, label: `${name} 在${listLabel(state.rankList)}的名次` });
  };
  drawStars();
  drawRanks();

  const onClick = (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const { action, value } = button.dataset;
    if (action === 'star-range') {
      state.stars = value;
      paint(root.querySelector('[data-part="star-range"]'), segmented(STAR_RANGES, value, { action, name: '时间范围' }));
      drawStars();
    } else if (action === 'rank-range' || action === 'rank-list') {
      if (action === 'rank-range') {
        state.rank = value;
        paint(root.querySelector('[data-part="rank-range"]'), segmented(RANK_RANGES, value, { action, name: '时间范围' }));
      } else {
        state.rankList = value;
        root.querySelectorAll('[data-action="rank-list"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
      }
      drawRanks();
    } else return;
    root.querySelector(`button[data-action="${action}"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
