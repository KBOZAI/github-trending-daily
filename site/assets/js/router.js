// Hash routes. Old links (#/day/..., #/repo/..., #/search?q=, #/stats) keep working.

const decode = (part) => {
  try { return decodeURIComponent(part); } catch { return part; }
};

export function parseHash(hash = location.hash) {
  const value = hash.replace(/^#\/?/, '');
  const at = value.indexOf('?');
  const path = at < 0 ? value : value.slice(0, at);
  const query = new URLSearchParams(at < 0 ? '' : value.slice(at + 1));
  const [head, ...rest] = path.split('/').filter(Boolean).map(decode);
  switch (head) {
    case undefined:
    case 'home':
      return { view: 'home', query };
    case 'day':
      return { view: 'day', date: rest[0] || null, query };
    case 'repo':
      return rest.length >= 2 ? { view: 'repo', name: `${rest[0]}/${rest[1]}`, query } : { view: 'notfound', query };
    case 'explore':
      return { view: 'explore', query };
    case 'search':
      return { view: 'explore', query, redirect: href.explore({ q: query.get('q') || '' }) };
    case 'insights':
      return { view: 'insights', query };
    case 'stats':
      return { view: 'insights', query, redirect: href.insights() };
    case 'compare':
      return { view: 'compare', query };
    case 'about':
      return { view: 'about', query };
    default:
      return { view: 'notfound', query };
  }
}

function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '' && value !== false) query.set(key, value === true ? '1' : value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export const href = {
  home: () => '#/',
  day: (date, { list = 'all', period = 'daily', sort = 'rank', tag = '' } = {}) => withQuery(
    `#/day${date ? `/${date}` : ''}`,
    { list: list === 'all' ? '' : list, period: period === 'daily' ? '' : period, sort: sort === 'rank' ? '' : sort, tag },
  ),
  repo: (name) => `#/repo/${name.split('/').map(encodeURIComponent).join('/')}`,
  explore: (params = {}) => withQuery('#/explore', params),
  compare: (names = []) => withQuery('#/compare', { r: names.join(',') }),
  insights: () => '#/insights',
  about: (section = '') => withQuery('#/about', { s: section }),
};
