// 关于: how to use the site, what each number means, where the data comes from, and its limits.
import { html, render as paint } from '../html.js';
import * as fmt from '../format.js';
import { href } from '../router.js';
import { getManifest } from '../data.js';

export async function render(root, route) {
  const m = getManifest();
  document.title = '关于与数据口径 · GitHub 热榜日报';
  const backfillEnd = m.backfill?.to;
  paint(root, html`<article class="view-about fade-in">
    <header>
      <p class="eyebrow"><span>关于与数据口径</span></p>
      <h1 class="page-title">读懂每天值得关注的开源项目</h1>
      <p class="lede">GitHub 热榜日报每天整理 <a href="https://github.com/trending" target="_blank" rel="noopener">GitHub Trending</a>，
        用中文说明项目是做什么的、能帮你解决什么问题、适合谁，并持续记录它的总 Stars 和上榜历史，帮你判断一个项目是一时热闹还是持续受关注。</p>
    </header>
    <div class="prose">
      <h2>怎么用</h2>
      <ul>
        <li><a href="${href.home()}">今日</a>：最新一期。先看总榜和每个项目的中文解读，再看“涨星最快”“新面孔”“持续在榜”。</li>
        <li><a href="${href.day(m.latest)}">榜单</a>：任意一天的完整榜单（总榜自 ${m.first}，分榜自 ${m.live_since}），可以按分类筛选、按总 Stars 或期间新增排序，← → 键翻日期。</li>
        <li><a href="${href.explore()}">项目库</a>：${fmt.int(m.counts.repos)} 个上过榜的项目，可按用途关键词、分类、语言、上榜时间和创建时间查找。</li>
        <li>项目档案：每个项目的解读、总 Stars 记录、上榜记录、基本信息和相关项目。</li>
        <li><a href="${href.compare()}">对比</a>：最多 4 个项目放在一起比较同一起点后的增长。</li>
      </ul>

      <h2 id="metrics">三种数字，三种口径</h2>
      <p>网站里的数字分成三类，含义不同，不能互相替代：</p>
      <div class="legend-defs">
        <div><b>★ 总 Stars</b>仓库获得的 Star 总数。本站每天通过 GitHub API 记录一次所有收录且可访问的仓库，项目离榜后也继续记录。</div>
        <div><b>+ 短期增长</b>“近 1 天 / 近 7 天”是本站两次记录之差；“Trending 今日 / 本周 / 本月”是 GitHub Trending 页面显示的期间新增，是 GitHub 的口径。</div>
        <div><b># 榜单名次</b>项目当天在某个 Trending 榜单上的顺序。“在榜 N 天”按有效采集日累计。</div>
      </div>
      <ul>
        <li><strong>Stars 曲线只画实际记录。</strong>本站从 ${m.stars?.since} 开始记录总 Stars，不代表项目创建以来的完整历史；没有记录的日子曲线会断开并标出“无观测”，不补值，也不把缺失记成 0。</li>
        <li><strong>增长只在有对应记录时计算。</strong>“近 7 天”需要 7 天前（最多再早 2 天）有一次记录，否则显示为观测不足，而不是估算。Stars 可能减少，数字和曲线保留真实升降。</li>
        <li><strong>Trending 的新增和本站的增长口径不同。</strong>前者是 GitHub 在采集那一刻显示的滚动窗口数值，后者是本站每天固定时间记录的总数之差，两者可能有出入。</li>
      </ul>

      <h2 id="sources">数据从哪里来</h2>
      <ul>
        <li><strong>每日榜单</strong>：每天采集总榜（今日 / 本周 / 本月）、中文项目榜，以及 ${m.lists.filter((l) => !['all', 'zh'].includes(l.key)).map((l) => l.name).join('、')} 语言榜，包括名次、当时的总 Stars、Fork 和期间新增。</li>
        <li><strong>历史排名</strong>：${m.first} 至 ${backfillEnd || '–'} 的总榜来自 <a href="${m.backfill?.source || 'https://github.com/antonkomarev/github-trending-archive'}" target="_blank" rel="noopener">antonkomarev/github-trending-archive</a>（MIT 许可），只有名次顺序。浏览这些日期时，显示的语言、解读和总 Stars 都是现在的数据。</li>
        <li><strong>总 Stars 记录</strong>：自 ${m.stars?.since} 起每天一次，目前每天记录 ${fmt.int(m.counts.tracked)} 个仓库。</li>
        <li><strong>仓库信息</strong>：话题、创建时间、许可证、主页等来自 GitHub API，定期刷新。</li>
        <li><strong>中文解读</strong>：根据项目 README 等公开资料整理，由 AI 辅助撰写，并记录来源链接和整理日期。只写资料里有依据的功能和用途，资料不足时宁可留空；项目自己的宣传性说法未经本站验证。目前 ${fmt.int(m.counts.explained)} 个项目有解读，会优先覆盖新上榜和长期上榜的项目。</li>
      </ul>

      <h2 id="limits">统计口径与局限</h2>
      <ul>
        <li>日期按采集时的 UTC 日期记（北京时间早 8 点换日）。GitHub 的“今日”榜是过去 24 小时的滚动窗口。</li>
        <li>某天的总榜和上一期完全相同时，标为疑似未更新（目前 ${m.stale.length} 天），照常展示，但这一天所有日榜都不计入上榜天数和连续天数。</li>
        <li>“连续上榜”按相邻的有效采集日计算：没有数据的日期会跳过，所以不一定是严格连续的日历天数。</li>
        <li>名次变化（▲▼）与该榜单上一个有效采集日比较；“回榜”表示此前上过、上一期不在榜。</li>
        <li>改过名的仓库合并到新名字下，旧链接会自动跳转；已删除或转为私有的仓库保留历史记录。</li>
        <li>GitHub 在 2024 年中缩短了 Trending 列表（从 25 个减少到十几个），跨时期比较上榜天数时需要考虑这一点。</li>
        <li>“AI 相关”占比和分类统计基于关键词和解读分类，属于估计，适合看趋势。</li>
      </ul>

      <h2 id="source-code">源码与原始数据</h2>
      <p>网站与采集脚本开源在 <a href="https://github.com/KBOZAI/github-trending-daily" target="_blank" rel="noopener">KBOZAI/github-trending-daily</a>。
        每日榜单在 <code>data/snapshots/</code>，Stars 记录在 <code>data/stars/</code>，中文解读在 <code>data/repos/summaries.json</code>，都可以直接下载分析。</p>
      <p class="muted">本页数据生成于 ${fmt.beijing(m.generated)}（北京时间），最新榜单日期 ${m.latest}。</p>
    </div>
  </article>`);
  const section = route.query.get('s');
  if (section) requestAnimationFrame(() => root.querySelector(`#${CSS.escape(section)}`)?.scrollIntoView());
}
