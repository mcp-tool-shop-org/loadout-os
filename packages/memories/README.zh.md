<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

用于 Claude Code 的 MEMORY.md 优化器和分发表生成器。

让您的 MEMORY.md 文件变得精简。claude-memories 分析您的记忆文件，生成一个机器可读的分发表，并显示您的上下文预算是如何分配的。

## 问题

Claude Code 的自动记忆功能会生成一个巨大的 MEMORY.md 文件，占用大量的上下文窗口。每次会话都会加载 40K+ 个令牌（token）的记忆数据，而其中大部分与当前任务无关。

## 解决方案

claude-memories 将您的记忆文件索引到分发表中。代理可以根据需要访问正确的记忆主题，而不是加载所有内容。

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**节省高达 98%** 的空间，适用于拥有 31 个主题的真实记忆工作区。

## 安装

```bash
npm install -g @mcptoolshop/claude-memories
```

## 命令

### analyze

分析 MEMORY.md 文件的结构、引用和令牌（token）成本。

```bash
claude-memories analyze MEMORY.md
```

### index

从您的记忆文件中生成一个分发表（index.json）。

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

检查记忆文件的结构问题。

```bash
claude-memories validate MEMORY.md
```

检查内容：缺少主题文件、孤立文件、重复引用、空名称。

### stats

令牌（token）预算仪表盘。

```bash
claude-memories stats MEMORY.md
```

```
╔══════════════════════════════════════════╗
║        Memory Token Budget               ║
╚══════════════════════════════════════════╝

  Total tokens:       43,127
  MEMORY.md inline:   669
  Topic files:        42,458

  Entries:            31
  Always loaded:      669 tokens
  On-demand total:    42,458 tokens
  Avg task load:      1,370 tokens
  Savings (lazy):     98%
```

## 工作原理

1. 解析 MEMORY.md 文件，查找主题引用（箭头格式：`Name → path`）。
2. 读取每个主题文件，从标题和内容中提取关键词。
3. 生成一个与 ai-loadout 兼容的 LoadoutIndex（分发表）。
4. 验证结构完整性（缺少文件、孤立文件、重复项）。

### 引用格式

MEMORY.md 文件的条目遵循以下格式：

```
Topic Name — description → `memory/topic-file.md`
```

支持项目符号和非项目符号格式：

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### 前言（可选）

主题文件可以包含前言，以实现更精细的控制：

```markdown
---
id: ai-loadout
keywords: [loadout, routing, dispatch, kernel]
patterns: [knowledge_routing]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# AI Loadout
...
```

如果没有前言，关键词将自动从主题名称和标题中提取。

## 架构

claude-memories 是知识操作系统堆栈中的 **第二层适配器**：

| 层级 | 包 | 角色 |
|-------|---------|------|
| 内核 | `@mcptoolshop/ai-loadout` | 路由类型、匹配、验证 |
| 适配器 | `@mcptoolshop/claude-rules` | CLAUDE.md 优化 |
| 适配器 | `@mcptoolshop/claude-memories` | MEMORY.md 优化 |

相同的内核，不同的文档类型。两者都生成兼容的分发表。

## 安全性

- **仅本地运行**：不进行任何网络调用，不收集任何遥测数据。
- **主要为读取**：仅写入 index.json 文件；从不修改 MEMORY.md 文件。
- **确定性**：相同的输入始终产生相同的输出。

请参阅 [SECURITY.md](SECURITY.md) 以了解威胁模型。

## 许可证

MIT

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建。
