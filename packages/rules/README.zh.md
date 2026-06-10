<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-rules/readme.png" width="400" alt="claude-rules">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/claude-rules"><img src="https://codecov.io/gh/mcp-tool-shop-org/claude-rules/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-rules"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-rules" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-rules/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

将您的 CLAUDE.md 文件进行优化。

`claude-rules` 是一个用于 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的分派表生成器和指令文件优化器。它将臃肿的指令文件拆分为一个微小的路由索引（始终加载）和特定主题的规则文件（按需加载），从而在每次会话中节省令牌。

## 问题

CLAUDE.md 文件会随着时间的推移而不断增长。每一行都会消耗令牌，无论是否重要。一个包含 300 行的指令文件实际上会给模型思考过程带来额外的负担。

## 解决方案

三层结构，没有歧义：

| 层级 | 文件 | 加载 |
|-------|------|--------|
| 操作控制台 | `CLAUDE.md` | 始终（精简索引） |
| 分派表 | `.claude/rules/index.json` | 始终（机器可读） |
| 规则内容 | `.claude/rules/*.md` | 按需 |

每个规则文件都包含其自身的路由元数据，作为前置信息。

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

当代理看到一个任务，其中提到了“CI”或“工作流程”时，它会读取相关的规则文件。其余文件保持未加载状态。

## 安装

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## 使用方法

### 分析

对 CLAUDE.md 文件的各个部分进行评分，并查看可以提取的内容：

```bash
claude-rules analyze
claude-rules analyze .claude/CLAUDE.md
```

```
File: .claude/CLAUDE.md  (258 lines, ~2388 tokens)

Keep inline (core): 4 sections
✓ (preamble)  2 lines
✓ Role  9 lines
✓ Guardian Self-Check  4 lines
✓ Document Delight  8 lines

Proposed extractions: 8 sections
  1. "GitHub Actions Rules" (L92-149, 58 lines, ~330 tokens)
     → .claude/rules/github-actions.md
     keywords: [github, actions, workflow, runner]

Budget estimate:
  Always loaded:    ~208 tokens (23 lines)
  On-demand:        ~2180 tokens (225 lines)
  Savings:          91% per session
```

### 拆分

交互式提取——在提取每个部分之前，您需要进行批准：

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

每个建议的提取都显示预览、建议的文件名、关键词和优先级。您可以批准或跳过每个部分。

### 验证

检查您的规则目录是否存在健康问题：

```bash
claude-rules validate
```

检查内容：缺少文件引用、孤立的规则文件、前置信息偏差、领域规则中缺少关键词、重复的 ID。

### 统计信息

查看您系统的运行状况：

```bash
claude-rules stats
```

```
claude-rules stats

  CLAUDE.md (always loaded)
    Lines: 42    Tokens (est): 320

  Rule files (on-demand)
    github-actions           56 lines    680 tokens  domain
    shipping                 38 lines    310 tokens  domain
    ownership                28 lines    210 tokens  domain
    ──────────────────────────────────────────────────────
    Total on-demand:        122 lines  1,200 tokens

  Budget
    Always loaded:         320 tokens
    On-demand total:     1,200 tokens
    Avg task load (est):   400 tokens
    Savings vs monolithic: 79%
```

## 优先级级别

| 级别 | 行为 | 示例 |
|------|----------|---------|
| `core` | 始终嵌入在 CLAUDE.md 中 | “除非有证据表明，否则假设是正确的” |
| `domain` | 当任务关键词匹配时加载 | 编辑 CI 时，加载 GitHub Actions 规则 |
| `manual` | 从不自动加载，需要手动查找 | 一些平台的隐藏问题 |

## 路由的工作方式

代理会查看 CLAUDE.md 中的分派表，并且两个信号会提示它加载一个规则文件：

1. **语义匹配**——任务中提到了“发布”或“CI”。
2. **明确指令**——CLAUDE.md 中会说明“在规划或编辑之前，读取该规则文件”。

这是一种提示代理循环的机制，而不是魔法。关键词匹配和明确指令的结合使其可靠。

## 不变性

- 每个提取的部分都会在 CLAUDE.md 中留下一个 1 行的摘要。
- 每个 `domain`/`manual` 规则都存在于 `index.json` 中。
- 每个 `core` 规则始终嵌入在文件中，不会单独提取。
- 前置信息是权威来源；`index.json` 是从前置信息派生而来。
- 解析器仅在 ATX 标题（`##`、`###`）处进行拆分。

## 安全性

此工具仅读取和写入本地 Markdown 和 JSON 文件。它不进行网络请求，不收集遥测数据，也不访问任何外部服务。

### 威胁模型

| 威胁 | 缓解措施 |
|--------|------------|
| 由于拆分不当导致的数据丢失 | 交互式批准 + `--dry-run` 模式 |
| 格式错误的规则文件 | `validate` 命令可以检测到所有结构性问题。 |
| 过时的索引 | `validate` 可以检测到前置信息和 `index.json` 之间的偏差。 |

有关完整安全策略，请参阅 [SECURITY.md](SECURITY.md)。

---

由 [MCP Tool Shop](https://mcp-tool-shop.github.io/) 构建。
