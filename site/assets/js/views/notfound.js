import { html, render as paint } from '../html.js';
import { href } from '../router.js';

export async function render(root) {
  document.title = '页面不存在 · GitHub 热榜日报';
  paint(root, html`<div class="state fade-in"><h2>没有这个页面</h2><p>链接可能写错了，或者页面已经调整。</p>
    <a class="btn" href="${href.home()}">回到今日</a> <a class="btn" href="${href.explore()}">去项目库找找</a></div>`);
}
