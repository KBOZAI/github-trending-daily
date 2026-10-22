# 数据约定（Data contract）

本文件说明仓库里**持久数据**的格式、**网页数据**（构建产物）的格式，以及各项指标的计算口径。
每日维护（Codex）和以后修改代码时都以这里为准。

- 持久数据在 `main` 分支的 `data/`，是唯一的事实来源，只追加、不改写历史。
- 网页数据由 `scripts/build.py` 从持久数据生成到 `site/data/`，不入库，随网页发布到 `gh-pages`。
- 日期一律是 **UTC 日期**（`YYYY-MM-DD`），时间戳是 UTC ISO 8601。

---

## 1. 持久数据（`data/`）

### 1.1 每日榜单 `data/snapshots/YYYY/YYYY-MM-DD.json`

由 `scripts/scrape.py` 写入，每个 UTC 日期一份，已存在时不覆盖（除非 `--force`）。

```json
{
  "date": "2026-10-21",
  "captured_at": "2026-10-21T12:57:35Z",
  "lists": {
    "all:daily": [
      {"rank": 1, "repo": "owner/name", "id": 123, "desc": "…", "lang": "Python",
       "stars": 62226, "forks": 19228, "gained": 3131}
    ],
    "all:weekly": [], "all:monthly": [], "zh:daily": [], "python:daily": []
  },
  "errors": {"rust:daily": "HTTP Error 503"},
  "stale": true
}
```

- 榜单键为 `<config 中的 key>:<period>`，取值见 `config.json` 的 `lists`。
- `stars` 是采集时页面上的总 Stars；`gained` 是 GitHub 页面显示的期间新增（daily = 过去 24 小时，weekly = 7 天，monthly = 30 天）。
- `errors`、`stale` 可选。`stale` 只是采集时的提示，构建时会按改名映射重新判断。

### 1.2 总 Stars 观测 `data/stars/YYYY/YYYY-MM-DD.json`

由 `scripts/track_stars.py` 每天写入，覆盖 `meta.json` 中所有可访问的仓库（包括已离榜的）。

```json
{"date": "2026-10-21", "source": "github-graphql", "captured_at": "2026-10-21T13:01:26Z",
 "stars": {"owner/name": 353813}, "missing": ["gone/repo"], "errors": {}, "complete": true}
```

- 只记录真实取到的数值；取不到时进入 `missing`（删除或转私有）或 `errors`（下次重试），**绝不写成 0**。
- `2026-10-09` 一份的 `source` 为 `dated-metadata-cache`：来自元信息缓存里带日期的真实观测，`captured_at` 为 `null`。
- 已有的日期文件不会被改写；同一天重跑只补齐缺失的仓库。

### 1.3 仓库元信息 `data/repos/meta.json`

由 `scripts/enrich.py` 维护，一行一个仓库（键为抓到时的名字）。

| 字段 | 说明 |
|---|---|
| `id`, `desc`, `lang`, `topics`(≤8), `created`, `pushed`, `stars`, `forks`, `license`, `homepage`, `org` | GitHub GraphQL 取得；`stars` 只是取元信息那一刻的值 |
| `fetched` | 取元信息的 UTC 日期 |
| `canonical` | 仓库改名后 GitHub 返回的新名字（与键不同才写） |
| `archived`, `fork` | 为真时才写 |
| `missing` | 删除、转私有或改名后不可访问；此时只有 `missing` 和 `fetched` |
| `release` *（新增，可选）* | `{"tag": "v1.2.0", "date": "2026-10-01"}`，最新 Release |
| `issues` *（新增，可选）* | 开放 Issue 数 |

`release`、`issues` 是本次重构新增的可选字段：最新榜单上的仓库会在下一次 `enrich.py` 时补上，其他旧条目保持原样也完全有效（网页缺字段时不显示）。

### 1.4 中文解读 `data/repos/summaries.json`

一行一个仓库。由 Codex 经 `scripts/prepare_introductions.py --apply` 导入（或可选的 `summarize.py` 模型接口）。

```json
"owner/name": {
  "zh": "一句话（≤60 字）",
  "intro": {
    "what": "是什么、做什么（≤100 字）",
    "use_cases": ["具体用途，1~3 条"],
    "audience": "适合谁",
    "features": ["可选：资料列出的主要能力，0~4 条"],
    "notes": ["可选：上手前须知，如运行环境、需要的 API Key、项目自述的早期状态，0~3 条"]
  },
  "tags": ["开发工具"],
  "src": "8 位描述哈希", "version": 3,
  "source": {"url": "README 链接", "sha": "…", "kind": "readme", "readme_sha": "…"},
  "model": "codex-task", "date": "2026-10-21"
}
```

- **版本兼容**：`version` 2（无 `features`/`notes`）与 3 都有效；版本号提升不会触发重写。
- 刷新条件（`summarize.needs_summary`）：缺失、版本低于 2、没有 `what`、项目简介变化（`src` 不同）、或超过 `config.json` 的 `introductions.refresh_days`（默认 30 天）且仍在最新榜单上。
- `tags` 只能取 `config.json` 中 `llm.tags` 的值，最多 2 个。
- 只写资料支持的内容，见 `AGENTS.md` 的写作规则。

### 1.5 历史排名 `data/backfill/antonkomarev/all-daily.json`

一次性导入的公开归档（MIT），`2023-09-09` 起的总榜“今日”榜，只有名字顺序：`{"source", "license", "note", "days": {"YYYY-MM-DD": ["owner/name", …]}}`。
该归档在列表不足 25 个时会用重复的名字补位；构建时去重并把名次按顺序重排（只对归档日这样做）。同一天有自己的抓取时，以自己的为准。

### 1.6 本地缓存 `data/repos/readmes.json`（不入库）

`prepare_introductions.py` 抓取的 README 摘录，键为仓库名：`{"url", "sha", "excerpt", "date", "desc"}`。`desc` 是准备时使用的项目简介，导入时用来计算 `src`。缺失这个文件不影响构建网页。

### 1.7 修改持久数据的规则

1. 只追加或补充字段，不删除、不改写已经发生的观测；新增字段必须是可选的。
2. 改名通过 `meta.json` 的 `canonical` 表达，不要去改历史快照里的名字。
3. 不补造缺失日期的数据；缺失就是缺失。
4. 结构性变化需要同时更新本文件、`scripts/dataset.py`（读取）、`tests/`。

---

## 2. 网页数据（`site/data/`，构建产物）

`python3 scripts/build.py` 生成以下文件，前端只读这些文件。所有 JSON 都是紧凑格式。

| 文件 | 内容 | 前端用途 |
|---|---|---|
| `index.json` | 清单（manifest） | 启动时读取，`no-cache` |
| `home.json` | 最新一期，自带卡片所需全部信息 | 今日 |
| `days/<date>.json` | 某天全部榜单与条目注释 | 榜单 |
| `catalog.json` | 所有项目一行一条的紧凑表 | 项目库、搜索建议、对比 |
| `search.json` | 简介原文与小写搜索文本 | 全文搜索（按需加载） |
| `repo/<shard>.json` | 项目详情：元信息、解读、上榜记录、相关项目 | 项目档案 |
| `stars/<year>/<shard>.json` | 总 Stars 观测（按日历对齐，缺失为 `null`） | 项目档案、对比 |
| `insights.json` | 长期统计 | 趋势 |

除 `index.json` 外，前端请求都带 `?v=<index.version>`，保证同一次发布的文件一起更新。

### 2.1 `index.json`

```json
{"schema": 3, "generated": "…Z", "version": "sha1 前 10 位", "latest": "2026-10-21", "first": "2023-09-09",
 "dates": [["2023-09-09", "2026-10-17"], ["2026-10-19", "2026-10-21"]],
 "stale": ["2025-11-14", "…"], "live_since": "2026-10-09",
 "lists": [{"key": "all", "name": "总榜", "periods": ["daily", "weekly", "monthly"]}],
 "since": {"all:daily": "2023-09-09", "python:daily": "2026-10-09"},
 "stars": {"since": "2026-10-09", "latest": "2026-10-21", "years": ["2026"]},
 "shards": 256, "categories": ["AI 智能体", "…"],
 "backfill": {"source": "https://github.com/antonkomarev/github-trending-archive", "to": "2026-10-08"},
 "counts": {"repos": 4603, "days": 1138, "tracked": 4502, "explained": 722}}
```

`dates` 是连续日期区间；`codex_daily.py verify` 只依赖 `latest`。

### 2.2 `days/<date>.json`

```json
{"date": "2026-10-21", "src": "live", "stale": false, "captured_at": "…", "errors": ["rust:daily"],
 "lists": {"all:daily": [{"r": "owner/name", "k": 1, "s": 62226, "f": 19228, "g": 3131,
                          "d": 11, "st": 5, "chg": 0, "new": 1, "back": 1}]},
 "repos": {"owner/name": {"zh": "…", "tags": ["…"], "desc": "无解读时的原文简介", "lang": "Python", "gone": 1}}}
```

- `r` 规范名，`k` 名次，`s`/`f`/`g` 采集时的总 Stars / Fork / 期间新增（只有实时采集日有）。
- `d` 截至当天在该榜的有效天数；`st` 当前连续天数（>1 才写）；`chg` 与该榜上一个有效采集日相比的名次变化（正数为上升）；`new` 该榜有记录以来第一次出现（榜单首日不标）；`back` 此前上过、上一期不在。疑似未更新日不写 `chg/new/back/st`。
- 归档日只有名次；网页从 `catalog.json` 取当前总 Stars，并标注为“当前总 Stars”。日文件里不放任何随日期变化的数值，这样历史日文件发布后基本不再变动，`gh-pages` 的历史不会每天整体膨胀。

### 2.3 `catalog.json`

```json
{"v": 3, "base": "2023-09-09", "star_date": "2026-10-21", "langs": ["Python", "…"], "tags": ["AI 智能体", "…"],
 "cols": ["name","zh","lang","stars","g1","g7","n","best","first","last","seen","na","created","flags","tags","st","sd","g7s","g30"],
 "rows": [["owner/name", "一句话", 0, 353813, 10320, 125619, 8, 1, 1124, 1132, 1138, 9, 948, 8, [7, 3]]]}
```

- 行内容按 `cols` 顺序，**末尾的空值被省略**。日期字段（`first`/`last`/`seen`/`created`/`sd`）是距 `base` 的天数。
- `lang`、`tags` 是 `langs`、`tags` 数组的下标（`-1` 表示无语言）。
- `stars` 最新记录值；`sd` 只有在最新记录早于 `star_date` 时才写。
- `g1`/`g7`/`g30` 见第 3 节；`g7s` 是实际跨度（不等于 7 时才写）。
- `n`/`best`/`first`/`last`/`st`：总榜“今日”榜的上榜天数、最好名次、首次、最近、当前连续；`seen` 最近出现在任一榜单的日期；`na` 出现在任一日榜的天数。
- `flags` 位：1 已删除或私有，2 已归档，4 Fork，8 有中文解读，16 组织账号。

### 2.4 `search.json`

`{"v": 3, "rows": [["原文简介（≤140 字）", "小写的话题 + 解读文本 + 曾用名"], …]}`，与 `catalog.rows` 一一对应。

### 2.5 `repo/<shard>.json`

```json
{"owner/name": {"name": "owner/name",
   "meta": {"desc", "lang", "topics", "created", "pushed", "license", "homepage", "forks", "fetched", "release", "issues",
            "gone": true, "archived": true, "fork": true, "org": true},
   "intro": {"zh", "what", "use_cases", "audience", "features", "notes", "tags", "date", "source"} ,
   "lists": {"all:daily": {"n": 8, "first": "…", "last": "…", "best": 1, "streak": 0, "longest": 8,
                           "h": [["2026-10-07", 8], ["2026-10-09", 1, 15335]]}},
   "related": [["other/repo", "一句话", "Rust"]], "aliases": ["old/name"]},
 "old/name": {"redirect": "owner/name"}}
```

`h` 每项为 `[日期, 名次, Trending 期间新增?]`；`intro` 没有解读时为 `null`。

### 2.6 `stars/<year>/<shard>.json`

`{"owner/name": ["2026-10-09", [38892, 64692, null, 85404]]}`：从第一个观测日开始逐日对齐，`null` 表示那天没有观测。只包含真实记录。

### 2.7 分片函数

`shard = FNV-1a-32(小写仓库名的 UTF-8 字节) mod shards`，格式化为两位十六进制。
Python：`scripts/build.py: shard_of`；JS：`site/assets/js/data.js: shardOf`。两边必须一致（`tests/test_build.py` 校验）。

### 2.8 `home.json`、`insights.json`

`home.json`：`date`、`src`、`stale`、`captured_at`、`star_date`、`lists`（同 days 格式）、`risers`（`g1`/`g7`/`rel7` 排名的仓库名）、`newcomers`、`first_week`（`[名字, 首次日期, 最好名次]`）、`list_new`、`sustained`（`[名字, 近 30 天在榜天数]`）、`window_start`，以及 `repos`：每个出现的仓库的卡片信息（`zh`/`what`/`uses`/`aud`/`tags`/`desc`/`lang`/`stars`/`sd`/`g1`/`g7`/`g30`（`[增量, 跨度]`）/`n`/`first`/`best`/`st`/`created`/`flags`/`spark`（`[起始日期, 近 15 天逐日总 Stars 或 null]`））。

`insights.json`：`months`、`ai`（AI 相关占比 %）、`lang`（主要语言月度占比 %）、`newcomers`、`size`、`topics`、`evergreen`（键 `30`/`90`/`365`/`0`）、`categories`、`categories_window`、`owners`、`kpi`。

---

## 3. 指标口径

| 指标 | 定义 |
|---|---|
| 总 Stars | 最新一次真实观测的总数（API 优先，同日没有 API 时用 Trending 页面采集值） |
| 近 1 / 7 / 30 天新增 | 最后一次观测减去“窗口起点”的观测。起点必须落在 `[最后日期 − 窗口 − 容差, 最后日期 − 窗口]` 内（容差：1 天为 0，7 天为 2，30 天为 3），否则视为未知，不估算 |
| 7 天增幅 | 7 天新增 ÷ 起点总 Stars，只统计起点 ≥ 500 的仓库 |
| Trending 新增 | GitHub 页面采集时显示的期间新增，原样展示 |
| 疑似未更新日 | 总榜（改名合并后）与上一个有数据日期完全相同；照常展示，但所有日榜在这一天都不计数 |
| 在榜天数 | 该榜出现的有效采集日数 |
| 连续天数 | 相邻有效采集日连续出现；没有数据的日期跳过而不中断 |
| 名次变化 | 与该榜上一个有效采集日比较 |
| 新面孔 | 第一次进入总榜（总榜自 2023-09-09 起有记录）；分榜自 2026-10-09 起 |
| AI 相关占比 | 名称/简介/话题匹配关键词，或解读分类属于 AI 智能体、大模型、AI 应用；为估计值 |
| 相关项目 | 共享 GitHub 话题（按 IDF 加权）、相同分类与语言的有解读项目，得分 ≥ 3 |

---

## 4. 从旧版迁移

- **持久数据无需迁移**：格式保持不变，只新增了可选字段（`meta.release`、`meta.issues`、解读的 `features`/`notes`、`version: 3`）。
- **网页数据整体更换**：旧的 `repos.json`（约 3 MB）、`stats.json`、`stars/owner/repo.json` 不再生成；`index.json` 保留文件名与 `latest` 字段。
- **网址兼容**：`#/day/<date>?list=&period=`、`#/repo/<owner>/<name>` 保持不变；`#/search?q=` 跳转到 `#/explore?q=`，`#/stats` 跳转到 `#/insights`；改名仓库的旧链接自动跳到新名字。
- **发布检查**：`codex_daily.py` 的 `check_site` 改为检查新的文件结构（`assets/`、`data/home.json`、完整的 `repo/` 分片等）。
