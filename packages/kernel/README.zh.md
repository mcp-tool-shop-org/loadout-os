<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-loadout/readme.png" width="400" alt="ai-loadout">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout"><img src="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/ai-loadout"><img src="https://img.shields.io/npm/v/@mcptoolshop/ai-loadout" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-loadout/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

面向 AI 代理的上下文感知知识路由器。

`ai-loadout` 是知识操作系统 (Knowledge OS) 堆栈的核心，包括分派表格式、匹配引擎、分层解析器以及代理运行时合约。 与将所有内容都放入上下文中不同，它维护一个小型索引，并根据需要加载数据包。

可以将其想象成游戏中的装备配置——在每个任务开始前，为代理配备它所需的精确知识。

## 安装

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## 核心概念

### 分派表

`LoadoutIndex` 是知识数据包的结构化索引：

```json
{
  "version": "1.0.0",
  "generated": "2026-03-06T12:00:00Z",
  "entries": [
    {
      "id": "github-actions",
      "path": ".rules/github-actions.md",
      "keywords": ["ci", "workflow", "runner"],
      "patterns": ["ci_pipeline"],
      "priority": "domain",
      "summary": "CI triggers, path gating, runner cost control",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 680,
      "lines": 56
    }
  ],
  "budget": {
    "always_loaded_est": 320,
    "on_demand_total_est": 8100,
    "avg_task_load_est": 520,
    "avg_task_load_observed": null
  }
}
```

### 优先级层级

| 层级 | 行为 | 示例 |
|------|----------|---------|
| `core` | 始终加载 | "永远不要跳过测试以使 CI 流程通过" |
| `domain` | 当任务关键词匹配时加载 | 编辑工作流时的 CI 规则 |
| `manual` | 从不自动加载，仅支持显式查找 | 一些平台上的特殊情况 |

### 数据包前言

每个数据包文件都包含其自身的路由元数据：

```markdown
---
id: github-actions
keywords: [ci, workflow, runner, dependabot]
patterns: [ci_pipeline]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# GitHub Actions Rules
CI minutes are finite...
```

前言是权威来源。索引是从其派生的。

## 代理运行时（主要 API）

运行时是代理消费知识包的规范方式。它涵盖整个流程：解析层级 → 匹配任务 → 决定加载的内容 → 记录使用情况。

### `planLoad(task, opts?)`

为给定的任务计划要加载的内容。这是面向代理的主要函数。

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

返回一个 `LoadPlan`，其中包含：
- `preload` / `onDemand` / `manual`：按加载模式分隔的条目
- `provenance`：每个条目来自哪个层级
- `budget`：解析后的索引的令牌预算
- `preloadTokens` / `onDemandTokens`：令牌成本总计
- `layerNames` / `conflicts`：层级元数据

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

记录代理已加载某个条目。这有助于实现可观察性（例如，未加载的条目、预算偏差、频率跟踪）。可选——仅在选项中设置了 `usagePath` 时才写入。

### `manualLookup(id, opts?)`

通过 ID 从解析后的索引中显式加载手动条目。

## 解析器

从规范的层级堆栈中发现并合并知识包索引：

1. **global** — `~/.ai-loadout/index.json`
2. **org** — 显式路径或 `$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — 显式路径或 `$AI_LOADOUT_SESSION`

后面的层级优先。缺少层级是正常的。

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## 匹配

### `matchLoadout(task, index)`

将任务描述与知识包索引进行匹配。返回按匹配强度排序的条目。

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- 核心条目始终包含（得分 1.0）
- 手动条目从不自动包含
- 领域条目的得分由关键词重叠 + 模式奖励决定
- 结果按得分降序排序，然后按令牌成本升序排序

### `lookupEntry(id, index)`

通过 ID 查找特定条目。用于手动条目或显式访问。

## 可观察性

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

仅追加的 JSONL 使用日志。从不连接网络，绝不收集用户数据。

### `findDeadEntries(index, events)`

查找从未加载的条目。

### `findKeywordOverlaps(index)`

查找条目之间共享的关键词（路由歧义）。

### `analyzeBudget(index, usage?)`

令牌预算分解，以及观察到的与估计值的比较。

## 合并

### `mergeIndexes(layers)`

用于分层配置的确定性合并。返回一个包含来源跟踪和冲突报告的 `MergedIndex` 对象。

## 实用工具

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

解析和序列化来自数据文件的 YAML 格式的头部信息。

### `validateIndex(index)`

验证 `LoadoutIndex` 对象的结构完整性。检查内容包括：必需字段、唯一 ID、kebab-case 格式、摘要范围、领域条目的关键词是否存在、有效的优先级、非负预算。

### `estimateTokens(text)`

根据文本估算令牌数量。使用字符数/4 的启发式方法。

## 命令行界面 (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

所有命令都支持 `--json` 参数，用于脚本编写。解析命令接受 `--project`、`--global`、`--org`、`--session` 参数。

## 类型

```typescript
import type {
  LoadoutEntry,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  ValidationIssue,
  Priority,          // "core" | "domain" | "manual"
  Triggers,          // { task, plan, edit }
  LoadMode,          // "eager" | "lazy" | "manual"
  Budget,
  UsageEvent,
  MergeConflict,
  MergedIndex,
  LoadPlan,          // returned by planLoad()
  ResolvedLoadout,   // returned by resolveLoadout()
  EntryExplanation,  // returned by explainEntry()
  IssueSeverity,     // "error" | "warning"
  RuntimeOptions,    // options for planLoad / recordLoad / manualLookup
  ResolveOptions,    // options for resolveLoadout / discoverLayers
  UsageSummary,      // returned by summarizeUsage()
  DeadEntry,         // returned by findDeadEntries()
  KeywordOverlap,    // returned by findKeywordOverlaps()
  BudgetBreakdown,   // returned by analyzeBudget()
  DiscoveredLayer,   // a layer found and loaded by the resolver
  SearchedLayer,     // a layer search location and its result
  EntryDefinition,   // one layer's version of a specific entry
} from "@mcptoolshop/ai-loadout";
```

## 消费者

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — 用于 Claude Code 的 CLAUDE.md 优化器。使用 ai-loadout 进行分派表和匹配。
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — 用于 Claude Code 的 MEMORY.md 优化器。从内存主题文件中生成分派表。

## 安全性

核心的匹配、合并和验证模块都是纯函数，没有副作用。使用模块（`recordUsage` / `readUsage`）执行本地文件系统 I/O，将数据写入仅追加的 JSONL 日志文件。解析器从标准层路径读取索引文件。没有网络请求，没有遥测数据，没有本地依赖。

### 威胁模型

| 威胁 | 缓解措施 |
|--------|------------|
| 格式错误的头部信息输入 | `parseFrontmatter()` 在无效输入时返回 `null`，不抛出异常，也不使用 `eval`。 |
| 原型污染 | 自定义解析器使用简单的对象字面量，不进行对不可信输入的递归合并。 |
| 包含错误数据的索引 | `validateIndex()` 在错误传播之前捕获结构性问题。 |
| 正则表达式拒绝服务 (DoS) 攻击 | 没有用户提供的正则表达式，模式作为纯字符串查找进行匹配。 |

请参阅 [SECURITY.md](SECURITY.md) 以获取完整的安全策略。

---

由 [MCP Tool Shop](https://mcp-tool-shop.github.io/) 构建。
