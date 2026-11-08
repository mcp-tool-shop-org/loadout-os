<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**适用于 AI 编码代理的知识操作系统。** 一个 CLI，可根据需要将正确的上下文路由到模型——而不是在每个会话开始时将所有内存文件和规则都转储到上下文窗口中。

您的指令文件和内存存储会无限增长。每一行都会在每个提示中消耗令牌，无论它是否与当前任务相关。loadout-os 始终加载一个小型调度索引，并且仅在任务关键字匹配时加载大型负载（内存主题、规则文件）。将其视为游戏装备：为代理配备其执行后续任务所需的知识。

## 内容

loadout-os 在一个 `loadout-os` 二进制文件中统一了四个界面：

| 界面 | 其作用 |
|---|---|
| **Kernel** (knowledge router) | 确定性关键字/模式匹配器、分层分层解析器（全局 → 组织 → 项目 → 会话）以及代理运行时协议。核心条目始终加载；域条目在匹配时加载；手动条目在显式查找时加载。 |
| **Memories adapter** | 将 `MEMORY.md` 存储（以及链接的 `index-*.md` 或 `metadata.loadout_role: subindex` 子索引）转换为机器可读的调度表，并对其进行检查（加载器截断限制为 180 行/24 KB——默认情况下发出警告，通过 `--max-lines`/`--max-bytes`、前置信息 `metadata.enforce_limits: true` 或 `.loadout.json` 启用时发出错误——此外还有缺失的文件、跨子索引的孤立条目、过时的要点摘要、重复条目、过长的条目）。 |
| **Rules adapter** | 将一个庞大的 `CLAUDE.md` 分割为一个精简的始终加载的索引以及按需加载的规则文件，并验证前置信息是否与索引匹配。 |
| **Runtime hooks** | `UserPromptSubmit` 指针路由器（`loadout-hook.mjs`，合并全局 + 项目层，并具有公平份额限制和子索引偏好）、`hook session-start`（UTF-8 板注入 + 过时和 shell 编辑刷新）、`hook pre-compact`（压缩前发出过时警告）和 `hook post-write`（`PostToolUse` 验证器 + 项目刷新）。 |

此外，还有三个仪式来维护系统的可靠性：**`refresh`**（重新生成 → 验证 → 将调度索引发布到全局或 `--project <root>`，并带有 `.bak` 补偿器、操作系统文件锁以及可选的 `--snapshot-repo` / `--mirror-repo`）、**`doctor`**（一个只读的 8 项健康检查屏幕）和 **`report`**（使用情况/无效条目/令牌预算的可观察性）。

## 命令界面

```
# Memory store adapter
loadout-os memories index          <MEMORY.md> [--id-source title|name] [--lazy] [--json]
loadout-os memories validate       <MEMORY.md> [--id-source title|name] [--max-lines <n>] [--max-bytes <n>] [--json]
loadout-os memories stats          <MEMORY.md> [--id-source title|name] [--json]
loadout-os memories health         [path] [--json]
loadout-os memories sync-summaries <MEMORY.md> [--fix] [--json]
loadout-os memories place          <topic.md> <index> [--store <dir>] [--into <index>] [--json]
loadout-os memories move           <topic.md> <index> [--store <dir>] [--into <index>] [--json]

# Instruction-file adapter
loadout-os rules analyze  <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]
loadout-os rules stats    <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules split    [CLAUDE.md] [--yes] [--dry-run]

# Knowledge router (flat kernel verbs)
loadout-os resolve                  # resolve layered loadouts
loadout-os explain <entry-id>       # how an entry resolved across layers
loadout-os usage <jsonl>            # usage summary from the event log
loadout-os dead <index> <jsonl>     # entries never loaded
loadout-os overlaps <index>         # keyword routing ambiguities
loadout-os budget <index> [jsonl]   # token budget breakdown
loadout-os validate <index>         # validate index STRUCTURE (kernel)

# Rituals + hooks
loadout-os doctor [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>] # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]      # drive the runtime hook on a sample prompt
loadout-os hook session-start [--project <r>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <r>]
loadout-os hook post-write    [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix]
loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--id-source title|name] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix] [--dry-run]
```

> **名称冲突，通过命名空间解决。** 扁平的 `validate <index>` 是内核的索引结构验证器。存储和规则检查器使用命名空间——`memories validate <MEMORY.md>` 和 `rules validate`——因此它们都可以共存。运行 `loadout-os <command> --help` 以获取每个命令的摘要、参数和退出代码。

## 项目层内存和 Claude 代码挂钩

每个项目实例都可以保留其自身的 `.claude/loadout/index.json`，这些数据是从其内存存储区（`loadout-os refresh --store <store> --project <root>`）构建而来。

### 1. 主题和看板前置信息

```markdown
---
name: Active Board
description: Current active task board and handoff state
priority: core
metadata:
  loadout_inject: session-start
  stale_after_min: 60
  max_lines: 60
  max_bytes: 6000
---
```

- 子索引（`index-*.md` 或带有 `metadata.loadout_role: subindex` 的文件）通过 `subindex: true` 扩展到调度索引的一个级别。
- `index-archive.md`（或带有 `metadata.loadout_default_priority: manual` 的子索引）默认情况下，其条目设置为 `priority: "manual"`，除非主题文件在前端明确设置了 `priority:`。
- 带有 `metadata.loadout_inject: session-start` 的 `core` 条目在 `SessionStart` 处完全注入（并且从每个提示的指针槽中排除，因此它们不会使已路由的条目饿死）。
- **条目 ID 来源（`idSource: "title" | "name"`）：** 显式的前端 `id:` 始终优先。当省略 `id:` 时，全局/`--dest` 存储默认设置为 `title`（带有 `MEMORY.md` 中的连字符分隔的要点标题，保留 `v1.0.4` 条目 ID），而 `--project` 存储默认设置为 `name`（带有 `name:` 的连字符分隔的前端）。通过 `<store>/.loadout.json`（`{ "idSource": "title" | "name" }`）或 `MEMORY.md` 前端（`metadata.id_source: title | name`），或通过在 `refresh` 和 `memories` 命令（这优先于存储设置）上使用 `--id-source title|name` 来覆盖每个存储。

### 2. 示例 `.claude/settings.local.json` 挂钩块

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/loadout-hook/loadout-hook.mjs"
          },
          {
            "type": "command",
            "command": "loadout-os hook session-start --user-prompt-submit"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook pre-compact"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook post-write --fix"
          }
        ]
      }
    ]
  }
}
```

> **关于 shell 编辑的说明：** 通过 shell（`Bash` / `PowerShell`）对内存文件进行的编辑会跳过 `PostToolUse`（`Write|Edit`）。作为内置的回退机制，`loadout-os hook session-start` 检查是否有任何 `<store>/*.md` 文件比项目 `index.json` 更新，并自动刷新项目索引（或者如果验证失败则发出警告）。

## 安装

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

内核也可以作为库导入——`@mcptoolshop/ai-loadout` 导出 `planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad` 和调度表类型。

## 文档

- **[手册](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**——概述、安装、架构、命令参考、仪式以及从旧版本软件包迁移。
- **[仓库](https://github.com/mcp-tool-shop-org/loadout-os)**——源代码、路线图和问题。

## 为什么需要整合

分解为秘密（Parnas 1972）对于 N 个人的团队来说是一个简洁的答案。对于一个单独的操作员和一个 LLM 团队来说，它在操作上是无效的：多仓库工作会将代理的上下文分散到不同的会话中，未发布的适配器会损坏（只有内核才会发布），并且进展会序列化到不同的仓库中。一个带有单个 CLI 的命名伞形仓库可以为操作员提供服务。

## 状态

已发布。**`@mcptoolshop/loadout-os`** 已发布到 npm（公共），并将内核、两个适配器（内存 + 规则）和实时运行时挂钩合并到一个 CLI 中——使用 `npm install -g @mcptoolshop/loadout-os` 进行安装。它所取代的三个旧版本软件包已退役：内核 `@mcptoolshop/ai-loadout` 已在 npm 上弃用（仍然可以安装，但不再进行任何进一步的开发）；`claude-memories` 和 `claude-rules` 仅为本地，并且已存档。所有新工作都将在此处进行。

## 信任模型

loadout-os 完全在您的机器上运行。没有网络调用、没有遥测，也没有帐户。

- **它访问的数据（仅限于本地）：**您的内存存储（`MEMORY.md` + 主题文件）、您的指令文件（`CLAUDE.md` + `.claude/rules/`）、生成的调度索引（位于存储旁边）、全局解析器索引（`~/.ai-loadout/index.json`）、项目解析器索引（`<project>/.claude/loadout/index.json`）以及仅追加的使用日志（`~/.ai-loadout/usage.jsonl`）。
- **它不访问的数据：**没有网络出口，没有遥测数据，没有远程服务，没有凭据或密钥。没有任何数据会被读取、存储或传输到上述本地磁盘路径之外。
- **所需权限：**仅限于本地文件系统。`doctor`和`report`仅进行读取操作（它们不会进行写入）。唯一的写入操作是索引文件、交互式`rules split`输出以及使用日志——所有这些都在上述预期的本地位置进行。不可逆的写入操作（`refresh`发布实时全局或项目索引）受到验证失败时的“andon halt”（紧急停止）的保护，并由`<dest>.bak`补偿器进行处理。提示和会话启动时的运行时钩子是“fail-open”（出错时允许继续）：每个错误路径都会退出`0`，因此它们永远不会阻止提示。

完整的威胁模型和报告流程：[SECURITY.md](./SECURITY.md)。

## 许可证

MIT——与所有上游源代码匹配。

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
