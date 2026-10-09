# GitHub 热榜日报

每天自动收集 [GitHub Trending](https://github.com/trending)，配上一句话中文简介，记录每个项目的上榜历史，并做长期统计。

**网页：** https://kbozai.github.io/github-trending-daily/

- **榜单**：按天浏览总榜（今日 / 本周 / 本月）、中文项目榜和 8 个语言榜；标出首次上榜、连续上榜天数、累计上榜天数
- **统计**：上榜天数排行、AI 相关项目占比、编程语言占比的月度趋势、近 30 天热门话题、上榜最多的作者 / 组织
- **项目页**：某个项目的历次名次和星数变化；可搜索所有上过榜的项目
- **历史回填**：2023-09-09 起的总榜来自 [antonkomarev/github-trending-archive](https://github.com/antonkomarev/github-trending-archive)（MIT，只有排名），所以统计从第一天起就有三年的数据

## 怎么运行的

GitHub Actions 每天 UTC 00:17（北京时间 08:17）跑一次 `.github/workflows/daily.yml`，03:17 再跑一次作为备份：

| 步骤 | 脚本 | 产出 |
|---|---|---|
| 抓取热榜页面 | `scripts/scrape.py` | `data/snapshots/YYYY/YYYY-MM-DD.json` |
| 补充话题、创建时间、许可证等 | `scripts/enrich.py`（GraphQL） | `data/repos/meta.json` |
| 生成中文简介和分类（可选） | `scripts/summarize.py` | `data/repos/summaries.json` |
| 汇总统计、生成网页数据 | `scripts/build.py` | `site/data/`（不入库，部署到 Pages） |

要追踪哪些榜单在 `config.json` 里改。

## 开启中文简介

简介由任意 OpenAI 兼容接口的大模型生成，默认用智谱免费的 GLM-4.7-Flash。没配置时网页显示英文原文简介，其余功能不受影响。

1. 在 [bigmodel.cn](https://bigmodel.cn) 申请 API key
2. 仓库 Settings → Secrets and variables → Actions → 新建 secret `LLM_API_KEY`
3. 换别的模型时，再加 variables `LLM_BASE_URL`（如 `https://api.deepseek.com/v1`）和 `LLM_MODEL`

只给当天新出现的项目生成，结果缓存，每天大约几十次调用。给历史项目补简介：`python scripts/summarize.py --backfill 500`。

## 本地运行

```bash
pip install -r requirements.txt
python scripts/scrape.py        # 抓今天（已有则跳过，--force 覆盖）
python scripts/enrich.py        # 需要 GITHUB_TOKEN 或已登录 gh
python scripts/build.py
cd site && python -m http.server 8000
```

## 数据口径

- 日期按抓取时的 UTC 日期记。GitHub 的“今日”榜是过去 24 小时的滚动窗口。
- 某天总榜与前一天完全相同时，视为 GitHub 端没有更新（例如 2025-11-13 至 12-04 的故障），网页上照常显示，但不计入上榜天数和连续天数。
- 改过名的仓库合并到新名字下；已删除或转私有的仓库保留记录。
- AI 相关占比按名称、简介、话题里的关键词估计，看趋势用。
- 回填的历史数据只有排名；这些天显示的简介、语言、星数是现在的数据。

## 许可

代码 MIT。`data/backfill/antonkomarev/` 来自 Anton Komarev 的归档（MIT，许可证见该目录）；`site/vendor/echarts.min.js` 为 Apache-2.0。
