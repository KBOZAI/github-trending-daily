// Project cards and rows shared by the front page, rankings and library.
import { html } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import {
  repoName, langDot, tagChip, starsMetric, trendingGain, observedGain, rankChange, listDays, sparkbars,
} from '../ui.js';

/**
 * Normalised project shape:
 * { name, rank, row (day-list row), listKey, period, zh, desc, uses, aud, tags, lang, created, gone,
 *   stars, starsLabel, trending, observed, days, streak, spark, today }
 */
function meta(p, { withDays = true } = {}) {
  return html`${langDot(p.lang)}
    ${(p.tags || []).map(tagChip)}
    ${p.created && p.today ? html`<span title="仓库创建于 ${p.created}">创建 ${fmt.age(p.created, p.today)}</span>` : ''}
    ${withDays ? listDays(p.days, p.streak) : ''}
    ${p.gone ? html`<span class="badge badge-gone">已删除或转为私有</span>` : ''}`;
}

function metrics(p) {
  return html`${p.stars != null ? starsMetric(p.stars, { label: p.starsLabel || '总 Stars', date: p.starsDate }) : ''}
    ${p.trending != null ? trendingGain(p.trending, p.period) : ''}
    ${p.observed ? observedGain(p.observed) : ''}`;
}

export function storyCard(p) {
  const uses = (p.uses || []).slice(0, 2);
  return html`<article class="story">
    <div class="story-top">
      ${p.rank != null ? html`<span class="story-rank ${p.rank > 9 ? 'small' : ''}" aria-label="第 ${p.rank} 名">${p.rank}</span>` : ''}
      <div class="story-head">
        ${repoName(p.name)}
        <div class="story-badges">${p.row && p.row.chg !== 0 ? rankChange(p.row, p.listKey) : ''}${listDays(p.days, p.streak)}</div>
      </div>
    </div>
    ${p.zh ? html`<p class="story-zh"><a href="${href.repo(p.name)}">${p.zh}</a></p>`
      : html`<p class="story-desc"><a href="${href.repo(p.name)}">${p.desc || '暂无简介'}</a></p>`}
    ${uses.length ? html`<ul class="story-uses" aria-label="可以用来">${uses.map((u) => html`<li>${u}</li>`)}</ul>` : ''}
    ${p.aud ? html`<p class="story-aud"><b>适合</b>${p.aud}</p>` : ''}
    <div class="story-meta">${meta(p, { withDays: false })}</div>
    <div class="story-foot"><div class="metrics">${metrics(p)}</div>${sparkbars(p.spark)}</div>
  </article>`;
}

export function listRow(p, { compact = false } = {}) {
  const ranked = p.rank != null || p.row;
  return html`<li class="row ${compact ? 'compact' : ''} ${ranked ? '' : 'no-rank'}">
    ${ranked ? html`<div class="row-rank ${p.rank != null && p.rank <= 3 ? 'top' : ''}">
      ${p.rank != null ? html`<b aria-label="第 ${p.rank} 名">${p.rank}</b>` : ''}
      ${p.row ? rankChange(p.row, p.listKey, { short: true }) : ''}
    </div>` : ''}
    <div class="row-main">
      <div class="row-title">${repoName(p.name)}</div>
      ${p.zh ? html`<p class="row-zh">${p.zh}</p>` : p.desc ? html`<p class="row-desc">${p.desc}</p>` : ''}
      <div class="row-meta">${meta(p)}${p.note ? html`<span>${p.note}</span>` : ''}</div>
    </div>
    <div class="row-metrics">${metrics(p)}</div>
  </li>`;
}

/** Card data for a repository in home.json (`brief`) plus its row on a list. */
export function fromBrief(name, brief = {}, row = null, { listKey = 'all:daily', period = 'daily', today } = {}) {
  return {
    name, rank: row?.k, row, listKey, period, today,
    zh: brief.zh, desc: brief.desc, uses: brief.uses, aud: brief.aud, tags: brief.tags, lang: brief.lang,
    created: brief.created, gone: Boolean((brief.flags || 0) & 1),
    stars: brief.stars ?? row?.s, starsDate: brief.sd,
    trending: row?.g, observed: brief.g7,
    days: row?.d ?? (listKey === 'all:daily' ? brief.n : null),
    streak: row?.st ?? (listKey === 'all:daily' ? brief.st : null),
    spark: brief.spark,
  };
}
