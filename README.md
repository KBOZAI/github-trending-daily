# GitHub 热榜日报

读懂每天值得关注的开源项目。每天整理 [GitHub Trending](https://github.com/trending)，用中文说明项目**做什么、能解决什么问题、适合谁**，并持续记录它的**总 Stars** 与**上榜历史**，帮你判断一个项目是一时热闹还是持续受关注。

**网页：** https://kbozai.github.io/github-trending-daily/

## 网站

| 页面 | 内容 |
|---|---|
| **今日** `#/` | 最新一期：总榜（今日 / 本周 / 本月）配中文解读；涨星最快（本站观测的近 1 天、近 7 天、7 天增幅）；本周新面孔；中文与各语言分榜；持续在榜；今日项目分类 |
| **榜单** `#/day/<日期>` | 2023-09-09 以来任意一天的完整榜单，名次变化（▲▼ / 首次 / 回榜）、在榜与连续天数，可按分类筛选、按总 Stars 或期间新增排序，← → 键翻日期 |
| **项目库** `#/explore` | 所有上过榜的项目（约 4,600 个），按用途关键词、分类、语言、上榜时间、创建时间筛选，按涨星、总 Stars、上榜天数等排序 |
| **项目档案** `#/repo/<owner>/<name>` | 中文解读（是什么、可以用来、适合谁、主要能力、上手前须知、资料来源）；总 Stars 记录图（只画真实观测，缺失日期断开并标注）与每日新增；各榜单名次记录；基本信息；相关项目 |
| **趋势** `#/insights` | AI 相关项目占比、编程语言格局、每月新面孔、总榜长度变化、热门话题、近期分类、长青项目、高产作者 |
| **对比** `#/compare` | 最多 4 个项目：同一起点后的 Stars 新增 / 增幅 / 总量，以及逐项比较 |
| **关于** `#/about` | 使用方法、数据来源、指标口径与局限 |

旧链接继续有效：`#/day/...`、`#/repo/...` 不变，`#/search?q=` 和 `#/stats` 会自动跳转。

## 数据口径（摘要）

- **三种数字分开呈现**：★ 总 Stars（本站每天的真实记录）、+ 短期增长（本站两次记录之差，或 GitHub Trending 页面显示的期间新增，二者明确标注来源）、# 榜单名次。
- **Stars 曲线只画实际观测**：本站从 2026-10-09 开始每天记录总 Stars；缺失日期断开并标“无观测”，开始记录前标“尚未开始记录”，不补值、不当作 0，也不代表项目的完整历史。
- **增长只在有对应记录时计算**：例如“近 7 天”需要 7 天前（最多再早 2 天）有记录，否则显示观测不足。
- **历史排名**：2023-09-09 起的总榜来自 [antonkomarev/github-trending-archive](https://github.com/antonkomarev/github-trending-archive)（MIT，只有名次）；分榜从 2026-10-09 开始采集。
- **疑似未更新日**：总榜与上一期完全相同时照常展示，但不计入上榜与连续天数。
- **中文解读**：依据 README 等公开资料，由 AI 辅助撰写并记录来源与日期；只写有依据的内容，宣传性说法不当作事实。

完整定义见 [`docs/DATA.md`](docs/DATA.md)。

## 怎么运行的

每天由本地 Codex 定时任务执行（命令见 [`AGENTS.md`](AGENTS.md)），静态网页发布在 `gh-pages`。

| 步骤 | 脚本 | 产出 |
|---|---|---|
| 抓取热榜页面 | `scripts/scrape.py` | `data/snapshots/YYYY/YYYY-MM-DD.json` |
| 补充话题、创建时间、许可证、最新版本、开放 Issue | `scripts/enrich.py`（GraphQL） | `data/repos/meta.json` |
| 记录所有已收录仓库的总 Stars | `scripts/track_stars.py`（GraphQL） | `data/stars/YYYY/YYYY-MM-DD.json` |
| 准备资料、导入 Codex 写的中文解读 | `scripts/prepare_introductions.py` | `data/repos/summaries.json`（README 缓存只留本地） |
| （可选）用模型接口生成解读 | `scripts/summarize.py` | 同上 |
| 汇总并生成网页数据 | `scripts/build.py`（读取逻辑在 `scripts/dataset.py`） | `site/data/`（不入库，随网页发布） |
| 校验、提交数据、发布网页 | `scripts/codex_daily.py` | `main` 上的数据提交、`gh-pages` |

每批解读先覆盖最新榜单上缺少或过期的项目，再按每天配额补写以前常上榜但还没有解读的项目；批量大小、配额和刷新周期在 `config.json` 的 `introductions` 中设置。要追踪哪些榜单也在 `config.json` 里改。

## 本地运行

```bash
pip install -r requirements.txt
python3 scripts/build.py                        # 从 data/ 生成 site/data/
python3 -m http.server 8000 --directory site    # 打开 http://localhost:8000
python3 -m unittest discover -s tests
```

网页是不需要构建工具的原生 ES 模块，没有第三方依赖；图表是自绘 SVG。修改 `site/assets/` 后刷新浏览器即可。

## 代码结构

```
scripts/                 采集、补充、解读、构建、发布（Python 标准库 + BeautifulSoup）
  dataset.py             把持久数据整理成按规范名合并的模型（改名、大小写、归档补位、疑似未更新日）
  build.py               生成 site/data/ 的各个文件
site/
  index.html
  assets/app.css         设计变量（含深色模式）与全部样式
  assets/js/main.js      外壳：路由、全局搜索、对比栏
  assets/js/data.js      读取网页数据、分片查找、搜索
  assets/js/charts.js    SVG 图表（Stars 记录、名次、折线、柱状、小图）
  assets/js/views/       今日、榜单、项目库、项目档案、趋势、对比、关于
data/                    持久数据（见 docs/DATA.md）
tests/                   python3 -m unittest discover -s tests
```

## 发布与自定义域名

Codex 在本地构建后推送静态文件到 `gh-pages`（Settings → Pages → Source 选择 Deploy from a branch，发布源为 `gh-pages` 根目录，包含 `.nojekyll`）。发布前 `codex_daily.py` 会检查文件结构、最新榜单不为空、详情分片完整、没有符号链接；只自动提交数据文件，遇到其他修改或远端新提交会停止，不强推。

自定义子域名：先在 Pages 设置填写域名，再在 DNS 服务商添加指向 `kbozai.github.io` 的 CNAME，等待 DNS 与 HTTPS 生效。见 [GitHub 官方说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。

## 许可

代码 MIT。`data/backfill/antonkomarev/` 来自 Anton Komarev 的归档（MIT，许可证见该目录）。
