// SVG charts drawn only from recorded values. Unobserved days are never interpolated:
// lines break at gaps, and gaps or not-yet-tracked periods are shaded and labelled.
import { compact, int, signed, md, shortDate, addDays, daysBetween } from './format.js';
import { escape } from './html.js';

const observers = new Set();
const byContainer = new WeakMap();
const r1 = (n) => Math.round(n * 10) / 10;

/** Disconnect resize observers of charts that belonged to the previous view. */
export function disposeCharts() {
  observers.forEach((o) => o.disconnect());
  observers.clear();
}

function responsive(container, draw) {
  const previous = byContainer.get(container);
  if (previous) { previous.disconnect(); observers.delete(previous); }
  let width = 0;
  const run = () => {
    const w = Math.round(container.clientWidth);
    if (!w || Math.abs(w - width) < 2) return;
    width = w;
    draw(w);
  };
  run();
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => requestAnimationFrame(run));
    observer.observe(container);
    observers.add(observer);
    byContainer.set(container, observer);
  }
}

export function niceScale(min, max, count = 4, { zero = false } = {}) {
  if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.04);
    min = zero && min >= 0 ? 0 : min - pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  step = Math.max(step, 1e-9);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(8)));
  return { lo, hi, ticks, step };
}

function dateTicks(d0, d1, plotWidth) {
  const span = Math.max(1, daysBetween(d0, d1));
  const count = Math.max(2, Math.min(8, Math.floor(plotWidth / 78)));
  const step = Math.max(1, Math.ceil(span / count));
  const ticks = [];
  for (let i = 0; i <= span; i += step) ticks.push(addDays(d0, i));
  if (daysBetween(ticks[ticks.length - 1], d1) > step / 2) ticks.push(d1);
  else ticks[ticks.length - 1] = d1;
  const long = span > 300;
  return ticks.map((d) => [d, long ? d.slice(0, 7) : shortDate(d)]);
}

function textWidth(text) {
  return [...String(text)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 7), 0);
}

/** Shared hover / touch / keyboard inspection: `points` carry x, y and tooltip html. */
function inspect(container, svg, points, { dots = (p) => [[p.x, p.y]], top = 0, bottom = 0 } = {}) {
  if (!points.length) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  container.append(tip);
  const cursor = svg.querySelector('.cursor');
  const hots = svg.querySelector('.hots');
  let index = -1;
  const scale = () => svg.viewBox.baseVal.width / svg.getBoundingClientRect().width || 1;
  const show = (i) => {
    index = Math.max(0, Math.min(points.length - 1, i));
    const p = points[index];
    if (cursor) {
      cursor.setAttribute('x1', p.x); cursor.setAttribute('x2', p.x);
      cursor.setAttribute('y1', top); cursor.setAttribute('y2', bottom);
      cursor.style.display = '';
    }
    if (hots) {
      hots.innerHTML = dots(p).map(([x, y, color = '']) => `<circle class="hot" ${color ? `style="fill:${color}"` : ''} cx="${r1(x)}" cy="${r1(y)}" r="5"/>`).join('');
    }
    tip.innerHTML = p.html;
    tip.hidden = false;
    const k = 1 / scale();
    const width = tip.offsetWidth;
    const left = Math.min(Math.max(p.x * k, width / 2 + 2), container.clientWidth - width / 2 - 2);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(p.tipY ?? p.y, 8) * k}px`;
  };
  const hide = () => {
    index = -1;
    tip.hidden = true;
    if (cursor) cursor.style.display = 'none';
    if (hots) hots.innerHTML = '';
  };
  const nearest = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) * scale();
    let best = 0;
    let distance = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < distance) { distance = d; best = i; }
    });
    return best;
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      show(index < 0 ? points.length - 1 : index + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      show(e.key === 'Home' ? 0 : points.length - 1);
    } else if (e.key === 'Escape') hide();
  });
  svg.addEventListener('blur', hide);
}

const svgOpen = (width, height, label) => `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" tabindex="0" aria-label="${escape(label)}">`;

// ----------------------------------------------------------------- Stars
/**
 * Total Stars (line through observed days) above daily increments (bars, consecutive days only).
 * `points` are [date, value] observations; `range` is [from, to]; `markers` are trending dates.
 */
export function starChart(container, points, { range, markers = [], label = '总 Stars 记录' } = {}) {
  responsive(container, (width) => {
    const [from, to] = range;
    const shown = points.filter(([d]) => d >= from && d <= to);
    if (!shown.length) {
      container.innerHTML = '<div class="chart-empty">这个时间范围内没有本站的 Stars 观测。</div>';
      return;
    }
    let d0 = from;
    let d1 = to;
    if (d0 === d1) { d0 = addDays(d0, -1); d1 = addDays(d1, 1); }
    const narrow = width < 560;
    const topH = narrow ? 180 : 220;
    const barH = narrow ? 64 : 76;
    const values = shown.map((p) => p[1]);
    const ys = niceScale(Math.min(...values), Math.max(...values), narrow ? 3 : 4);
    const deltas = [];
    for (let i = 1; i < shown.length; i += 1) {
      if (daysBetween(shown[i - 1][0], shown[i][0]) === 1) deltas.push([shown[i][0], shown[i][1] - shown[i - 1][1]]);
    }
    const dv = deltas.map((d) => d[1]);
    const bs = niceScale(Math.min(0, ...dv), Math.max(1, ...dv), 2, { zero: true });
    const left = Math.max(46, Math.max(...ys.ticks.map((t) => textWidth(compact(t))), textWidth(compact(bs.hi))) + 14);
    const m = { l: left, r: 12, t: 22 };
    const plotW = width - m.l - m.r;
    const span = Math.max(1, daysBetween(d0, d1));
    const x = (d) => m.l + (daysBetween(d0, d) / span) * plotW;
    const y = (v) => m.t + topH - ((v - ys.lo) / (ys.hi - ys.lo || 1)) * topH;
    const barTop = m.t + topH + 34;
    const yb = (v) => barTop + barH - ((v - bs.lo) / (bs.hi - bs.lo || 1)) * barH;
    const visibleMarkers = markers.filter((d) => d >= d0 && d <= d1);
    const markerY = barTop + barH + 12;
    const axisY = markerY + (visibleMarkers.length ? 20 : 4) + 12;
    const height = axisY + 8;
    const parts = [svgOpen(width, height, `${label}：${shown[0][0]} 至 ${shown[shown.length - 1][0]}，共 ${shown.length} 个观测日`)];

    // grid + y labels
    parts.push('<g class="grid">');
    ys.ticks.forEach((t) => parts.push(`<line x1="${m.l}" x2="${width - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`));
    parts.push(`<line class="base" x1="${m.l}" x2="${width - m.r}" y1="${r1(yb(0))}" y2="${r1(yb(0))}"/>`);
    parts.push('</g><g class="axis">');
    ys.ticks.forEach((t) => parts.push(`<text class="end" x="${m.l - 8}" y="${r1(y(t) + 4)}">${compact(t)}</text>`));
    parts.push(`<text class="end" x="${m.l - 8}" y="${r1(yb(bs.hi) + 4)}">${compact(bs.hi)}</text>`);
    parts.push(`<text class="end" x="${m.l - 8}" y="${r1(yb(0) + 4)}">0</text>`);
    parts.push(`<text class="start" x="${m.l}" y="${m.t - 9}" style="font-family:var(--sans)">${ys.lo > 0 ? '总 Stars · 纵轴不从 0 开始' : '总 Stars'}</text>`);
    parts.push(`<text class="start" x="${m.l}" y="${barTop - 9}" style="font-family:var(--sans)">每日新增（相邻两天都有观测时）</text>`);
    parts.push('</g>');

    // untracked period and gaps between observations
    const bands = [];
    if (shown[0][0] > d0) bands.push([d0, shown[0][0], points[0][0] > d0 ? '尚未开始记录' : '无观测', true]);
    for (let i = 1; i < shown.length; i += 1) {
      if (daysBetween(shown[i - 1][0], shown[i][0]) > 1) bands.push([shown[i - 1][0], shown[i][0], '无观测', false]);
    }
    if (shown[shown.length - 1][0] < d1) bands.push([shown[shown.length - 1][0], d1, '无观测', false]);
    bands.forEach(([a, b, text, leading]) => {
      const xa = leading ? x(a) : x(a) + 3;
      const xb = x(b) - 3;
      if (xb - xa < 2) return;
      parts.push(`<rect class="gap-band" x="${r1(xa)}" y="${m.t}" width="${r1(xb - xa)}" height="${topH}" rx="3"/>`);
      if (xb - xa > textWidth(text) + 8) parts.push(`<text class="gap-label" x="${r1((xa + xb) / 2)}" y="${r1(m.t + topH / 2)}">${text}</text>`);
    });

    // line segments only between consecutive observed days
    let path = '';
    shown.forEach(([d, v], i) => {
      const joined = i > 0 && daysBetween(shown[i - 1][0], d) === 1;
      path += `${joined ? 'L' : 'M'}${r1(x(d))},${r1(y(v))}`;
    });
    parts.push(`<path class="line" d="${path}"/>`);
    if (shown.length <= 120) shown.forEach(([d, v]) => parts.push(`<circle class="dot" cx="${r1(x(d))}" cy="${r1(y(v))}" r="${shown.length > 45 ? 2 : 3}"/>`));

    // daily increments
    const slot = plotW / span;
    const bw = Math.max(2, Math.min(16, slot * 0.66));
    deltas.forEach(([d, v]) => {
      const top = Math.min(yb(v), yb(0));
      const h = Math.max(1, Math.abs(yb(v) - yb(0)));
      parts.push(`<rect class="bar ${v < 0 ? 'neg' : ''}" x="${r1(x(d) - bw / 2)}" y="${r1(top)}" width="${r1(bw)}" height="${r1(h)}" rx="1.5"/>`);
    });

    // trending days
    if (visibleMarkers.length) {
      parts.push(`<g class="axis"><text class="end" x="${m.l - 8}" y="${markerY + 8}" style="font-family:var(--sans)">上榜</text></g>`);
      const mw = Math.max(2, Math.min(10, slot * 0.6));
      visibleMarkers.forEach((d) => parts.push(`<rect class="marker" x="${r1(x(d) - mw / 2)}" y="${markerY}" width="${r1(mw)}" height="9" rx="1.5"/>`));
    }

    // x axis
    parts.push('<g class="axis">');
    dateTicks(d0, d1, plotW).forEach(([d, text], i, all) => {
      const anchor = i === 0 ? 'start' : i === all.length - 1 ? 'end' : '';
      parts.push(`<text class="${anchor}" x="${r1(x(d))}" y="${axisY}" text-anchor="${anchor ? '' : 'middle'}">${text}</text>`);
    });
    parts.push('</g>');
    parts.push(`<line class="cursor" style="display:none"/><g class="hots"></g></svg>`);
    container.innerHTML = parts.join('');

    const byDate = new Map(deltas);
    const tips = shown.map(([d, v], i) => {
      let change = '<span class="muted">本站首次记录</span>';
      if (i > 0) {
        const [pd, pv] = shown[i - 1];
        const gap = daysBetween(pd, d);
        const diff = v - pv;
        change = gap === 1
          ? `较前一天 <b class="up">${signed(diff)}</b>`
          : `较 ${shortDate(pd)}（${gap} 天前的观测）<b class="up">${signed(diff)}</b>`;
      } else if (points[0][0] < d) {
        change = '<span class="muted">所选范围内的第一个观测</span>';
      }
      return { x: x(d), y: y(v), tipY: y(v) - 4, html: `${md(d)} <span class="muted">UTC</span><br>总 Stars <b>${int(v)}</b><br>${change}`, d, bar: byDate.get(d) };
    });
    inspect(container, container.querySelector('svg'), tips, {
      top: m.t, bottom: barTop + barH,
      dots: (p) => [[p.x, p.y]],
    });
  });
}

// ------------------------------------------------------------------ ranks
/** Rank on one list over time (1 at the top). `history` rows are [date, rank, gained?]. */
export function rankChart(container, history, { range, period = '今日', label = '名次记录' } = {}) {
  responsive(container, (width) => {
    const [from, to] = range;
    const shown = history.filter(([d]) => d >= from && d <= to);
    if (!shown.length) {
      container.innerHTML = '<div class="chart-empty">这个时间范围内没有上榜记录。</div>';
      return;
    }
    const narrow = width < 560;
    const plotH = narrow ? 150 : 180;
    const maxRank = Math.max(10, Math.ceil(Math.max(...shown.map((h) => h[1])) / 5) * 5);
    const m = { l: 40, r: 12, t: 12 };
    const plotW = width - m.l - m.r;
    let d0 = from;
    let d1 = to;
    if (d0 === d1) { d0 = addDays(d0, -1); d1 = addDays(d1, 1); }
    const span = Math.max(1, daysBetween(d0, d1));
    const x = (d) => m.l + (daysBetween(d0, d) / span) * plotW;
    const y = (rank) => m.t + ((rank - 1) / (maxRank - 1)) * plotH;
    const axisY = m.t + plotH + 22;
    const height = axisY + 8;
    const parts = [svgOpen(width, height, `${label}：共 ${shown.length} 次，最好第 ${Math.min(...shown.map((h) => h[1]))} 名`)];
    const ticks = [1, ...Array.from({ length: maxRank / 5 }, (_, i) => (i + 1) * 5)];
    parts.push('<g class="grid">');
    ticks.forEach((t) => parts.push(`<line x1="${m.l}" x2="${width - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`));
    parts.push('</g><g class="axis">');
    ticks.forEach((t) => parts.push(`<text class="end" x="${m.l - 8}" y="${r1(y(t) + 4)}">#${t}</text>`));
    dateTicks(d0, d1, plotW).forEach(([d, text], i, all) => {
      const anchor = i === 0 ? 'start' : i === all.length - 1 ? 'end' : '';
      parts.push(`<text class="${anchor}" x="${r1(x(d))}" y="${axisY}" text-anchor="${anchor ? '' : 'middle'}">${text}</text>`);
    });
    parts.push('</g>');
    let path = '';
    shown.forEach(([d, rank], i) => {
      const joined = i > 0 && daysBetween(shown[i - 1][0], d) === 1;
      path += `${joined ? 'L' : 'M'}${r1(x(d))},${r1(y(rank))}`;
    });
    parts.push(`<path class="rank-line" d="${path}"/>`);
    const radius = shown.length > 150 ? 2 : shown.length > 50 ? 2.6 : 3.4;
    shown.forEach(([d, rank]) => parts.push(`<circle class="rank-dot" cx="${r1(x(d))}" cy="${r1(y(rank))}" r="${radius}"/>`));
    parts.push('<line class="cursor" style="display:none"/><g class="hots"></g></svg>');
    container.innerHTML = parts.join('');
    const tips = shown.map(([d, rank, gained]) => ({
      x: x(d), y: y(rank), tipY: y(rank) - 4,
      html: `${md(d)} <span class="muted">${d.slice(0, 4)}</span><br>第 <b>${rank}</b> 名${gained != null ? `<br><span class="muted">Trending ${period}</span> <b class="up">${signed(gained)}</b>` : ''}`,
    }));
    inspect(container, container.querySelector('svg'), tips, { top: m.t, bottom: m.t + plotH });
  });
}

// ------------------------------------------------------------ line / columns
/**
 * Generic line chart over categorical labels. series: [{name, values (null = gap), cls}].
 */
export function lineChart(container, { labels, series, format = (v) => v, tickFormat = format, labelFormat = (l) => l,
  zero = true, max = null, height: fixedHeight = null, label = '', tipLabel = (l) => l } = {}) {
  responsive(container, (width) => {
    const narrow = width < 560;
    const plotH = fixedHeight ?? (narrow ? 170 : 210);
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (!all.length) {
      container.innerHTML = '<div class="chart-empty">暂无数据。</div>';
      return;
    }
    const ys = niceScale(Math.min(...all), max ?? Math.max(...all), narrow ? 3 : 4, { zero });
    const left = Math.max(36, Math.max(...ys.ticks.map((t) => textWidth(tickFormat(t)))) + 14);
    const m = { l: left, r: 14, t: 12 };
    const plotW = width - m.l - m.r;
    const n = labels.length;
    const x = (i) => m.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v) => m.t + plotH - ((v - ys.lo) / (ys.hi - ys.lo || 1)) * plotH;
    const axisY = m.t + plotH + 22;
    const parts = [svgOpen(width, axisY + 8, label)];
    parts.push('<g class="grid">');
    ys.ticks.forEach((t) => parts.push(`<line x1="${m.l}" x2="${width - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`));
    parts.push('</g><g class="axis">');
    ys.ticks.forEach((t) => parts.push(`<text class="end" x="${m.l - 8}" y="${r1(y(t) + 4)}">${escape(tickFormat(t))}</text>`));
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));
    labels.forEach((l, i) => {
      if (i % every && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every * 0.6) return;
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : '';
      parts.push(`<text class="${anchor}" x="${r1(x(i))}" y="${axisY}" text-anchor="${anchor ? '' : 'middle'}">${escape(labelFormat(l))}</text>`);
    });
    parts.push('</g>');
    series.forEach((s) => {
      let path = '';
      s.values.forEach((v, i) => {
        if (v == null) return;
        path += `${i > 0 && s.values[i - 1] != null ? 'L' : 'M'}${r1(x(i))},${r1(y(v))}`;
      });
      const stroke = s.color ? `style="stroke:${s.color}"` : '';
      parts.push(`<path class="line" ${stroke} d="${path}"/>`);
      s.values.forEach((v, i) => {
        const isolated = v != null && (i === 0 || s.values[i - 1] == null) && (i === n - 1 || s.values[i + 1] == null);
        if (isolated) parts.push(`<circle class="dot solid" ${s.color ? `style="fill:${s.color}"` : ''} cx="${r1(x(i))}" cy="${r1(y(v))}" r="3"/>`);
      });
    });
    parts.push('<line class="cursor" style="display:none"/><g class="hots"></g></svg>');
    container.innerHTML = parts.join('');
    const tips = labels.map((l, i) => {
      const rows = series.filter((s) => s.values[i] != null)
        .map((s) => `${series.length > 1 ? `<span style="color:${s.color || 'inherit'}">●</span> ${escape(s.name)} ` : ''}<b>${escape(format(s.values[i]))}</b>`);
      const ysAt = series.map((s) => (s.values[i] == null ? null : y(s.values[i]))).filter((v) => v != null);
      return { x: x(i), y: ysAt.length ? Math.min(...ysAt) : m.t + plotH, html: `${escape(tipLabel(l))}<br>${rows.join('<br>') || '<span class="muted">无数据</span>'}`, i };
    });
    inspect(container, container.querySelector('svg'), tips, {
      top: m.t, bottom: m.t + plotH,
      dots: (p) => series.map((s) => (s.values[p.i] == null ? null : [p.x, y(s.values[p.i]), s.color || ''])).filter(Boolean),
    });
  });
}

export function columnChart(container, { labels, values, format = (v) => int(v), labelFormat = (l) => l, label = '',
  tipLabel = (l) => l, dim = () => false } = {}) {
  responsive(container, (width) => {
    const narrow = width < 560;
    const plotH = narrow ? 150 : 180;
    const ys = niceScale(0, Math.max(1, ...values), 3, { zero: true });
    const left = Math.max(32, Math.max(...ys.ticks.map((t) => textWidth(format(t)))) + 14);
    const m = { l: left, r: 10, t: 10 };
    const plotW = width - m.l - m.r;
    const n = values.length;
    const slot = plotW / n;
    const bw = Math.max(2, slot * 0.7);
    const x = (i) => m.l + slot * i + slot / 2;
    const y = (v) => m.t + plotH - (v / (ys.hi || 1)) * plotH;
    const axisY = m.t + plotH + 22;
    const parts = [svgOpen(width, axisY + 8, label), '<g class="grid">'];
    ys.ticks.forEach((t) => parts.push(`<line class="${t === 0 ? 'base' : ''}" x1="${m.l}" x2="${width - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`));
    parts.push('</g><g class="axis">');
    ys.ticks.forEach((t) => parts.push(`<text class="end" x="${m.l - 8}" y="${r1(y(t) + 4)}">${escape(format(t))}</text>`));
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));
    labels.forEach((l, i) => {
      if ((n - 1 - i) % every) return;
      parts.push(`<text x="${r1(x(i))}" y="${axisY}" text-anchor="middle">${escape(labelFormat(l))}</text>`);
    });
    parts.push('</g>');
    values.forEach((v, i) => parts.push(`<rect class="col ${dim(i) ? 'dim' : ''}" x="${r1(x(i) - bw / 2)}" y="${r1(y(v))}" width="${r1(bw)}" height="${r1(Math.max(0, y(0) - y(v)))}" rx="2"/>`));
    parts.push('<line class="cursor" style="display:none"/><g class="hots"></g></svg>');
    container.innerHTML = parts.join('');
    const tips = values.map((v, i) => ({ x: x(i), y: y(v), html: `${escape(tipLabel(labels[i]))}<br><b>${escape(format(v))}</b>` }));
    inspect(container, container.querySelector('svg'), tips, { top: m.t, bottom: m.t + plotH, dots: () => [] });
  });
}

/** Static mini line for small multiples (shared y maximum so panels compare honestly). */
export function miniLine(values, max, { width = 160, height = 44 } = {}) {
  const n = values.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * (width - 4) + 2 : width / 2);
  const y = (v) => height - 2 - (v / (max || 1)) * (height - 6);
  let path = '';
  values.forEach((v, i) => { if (v != null) path += `${i && values[i - 1] != null ? 'L' : 'M'}${r1(x(i))},${r1(y(v))}`; });
  const area = `${path}L${r1(x(n - 1))},${height - 2}L${r1(x(0))},${height - 2}Z`;
  return `<svg class="mini" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px" aria-hidden="true"><path d="${area}" fill="var(--c)" opacity=".12"/><path d="${path}" fill="none" stroke="var(--c)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
