<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

您的指令文件和内存存储会无限增长。每一行都会在每个提示中消耗令牌，无论它是否与当前任务相关。loadout-os 始终加载一个小型调度索引，并且仅在任务关键字匹配时才加载大型负载（内存主题、规则文件）。将其视为游戏装备：为代理配备执行后续任务所需的精确知识。

## 内容

loadout-os 在一个 `loadout-os` 二进制文件中统一了四个界面：

| 界面 | 其作用 |
|---|---|
| **Kernel** (knowledge router) | 确定性关键字/模式匹配器、分层分层解析器（全局 → 组织 → 项目 → 会话）以及代理运行时协议。核心条目始终加载；域条目在匹配时加载；手动条目在显式查找时加载。 |
| **Memories adapter** | 将一个 `MEMORY.md` 存储（以及链接的 `index-*.md` 或 `metadata.loadout_role: subindex` 子索引）转换为机器可读的调度表，并对其进行检查（加载器截断限制为 180 行/24 KB——默认情况下发出警告，通过 `--max-lines`/`--max-bytes`、前置信息 `metadata.enforce_limits: true` 或 `.loadout.json` 启用时发出错误——此外还有缺失的文件、跨子索引的孤立条目、过时的要点摘要、重复条目、过长的条目）。 |
| **Rules adapter** | 将一个臃肿的 `CLAUDE.md` 分割为一个精简的始终加载的索引，以及按需加载的规则文件，并验证前置信息是否与索引匹配。 |
| **Runtime hooks** | `UserPromptSubmit` 指针路由器（`loadout-hook.mjs`，合并全局 + 项目层，并具有公平份额限制和子索引优先级）、`hook session-start`（UTF-8 注入 + 过时和 shell 编辑刷新）、`hook pre-compact`（压缩前发出过时警告）、`hook post-write`（`PostToolUse` 验证器 + 项目刷新）和 `hook pre-tool`（`PreToolUse` A/B 保护层 + 决策记录器）。 |

此外，还有三个仪式来维护系统的可靠性：**`refresh`**（重新生成 → 验证 → 将调度索引发布到全局或 `--project <root>`，并带有 `.bak` 补偿器、OS 文件锁以及可选的 `--snapshot-repo` / `--mirror-repo`）、**`doctor`**（一个只读的健康状况屏幕，包括三元检查）和 **`report`**（使用情况/无效条目/令牌预算的可观察性）。

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
loadout-os memories split          [<MEMORY.md>] --by <rules.json> [--store <dir>] [--id-source title|name] [--dry-run] [--json]

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
loadout-os doctor [--profiles <p>] [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>]                  # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]                       # drive the runtime hook on a sample prompt
loadout-os hook session-start [--project <r>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <r>]
loadout-os hook post-write    [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix]
loadout-os hook pre-tool      [--mode enforce|log-only] [--profiles <p>] [--log <p>] [--timeout-ms <ms>]
loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--profiles <p>] [--allow-store-change] [--id-source title|name] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix] [--dry-run]
```

> **名称冲突，通过命名空间解决。** 扁平的 `validate <index>` 是内核的索引结构验证器。存储和规则检查器都使用命名空间——`memories validate <MEMORY.md>` 和 `rules validate`——因此它们都可以共存。运行 `loadout-os <command> --help` 以获取每个命令的摘要、参数和退出代码。

## 项目层内存和 Claude 代码挂钩连接

每个项目资料都可以保留其自身的 `.claude/loadout/index.json`，这些数据来自其存储器（`loadout-os refresh --store <store> --project <root>`）。

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

- 子索引（`index-*.md`或带有`metadata.loadout_role: subindex`的文件）会扩展一级，并将其合并到带有`subindex: true`的调度索引中。
- `index-archive.md`（或带有`metadata.loadout_default_priority: manual`的子索引）默认情况下，其条目的值为`priority: "manual"`，除非主题文件中明确设置了前置信息中的`priority:`。
- 带有`metadata.loadout_inject: session-start`的`core`条目会在`SessionStart`处完全插入（并且从每个提示的指针槽中排除，以确保它们不会导致路由条目出现资源不足的情况）。
- **条目 ID 来源（`idSource: "title" | "name"`）：** 明确的前置信息`id:`始终优先。当省略`id:`时，全局/`--dest`存储会默认设置为`title`（带有连字符的列表标题，位于`MEMORY.md`中，保留`v1.0.4`条目 ID），而`--project`存储会默认设置为`name`（带有连字符的前置信息`name:`）。可以通过`<store>/.loadout.json`（`{ "idSource": "title" | "name" }`）或`MEMORY.md`前置信息（`metadata.id_source: title | name`）来覆盖每个存储，或者通过在`refresh`和`memories`命令（`--id-source title|name`）上进行操作来覆盖每次调用（这将优先于存储设置）。

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
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook pre-tool --mode enforce"
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

### 3. PreToolUse 挂钩和 `profiles.json`

`loadout-os hook pre-tool` 在执行之前对工具调用进行保护，静默放行只读工具和只读 Bash 管道（`exit 0`），根据活动配置文件评估 A/B 规则表，将哈希决策（`input_hash`，绝不使用原始命令文本）记录到 `~/.ai-loadout/hook-decisions.jsonl`，在匹配到块之前失败（开放），并在匹配到块规则后失败（封闭）（`exit 2` + 仅 stderr）。

**内置规则：**

| 规则 ID | 层 | 工具 | 默认操作 | 目的 |
|---|---|---|---|---|
| `unreviewed-merge` | A | `Bash` | `warn` | 提醒在合并之前验证记录的审核通过（`PASS at <head8>`） |
| `quote-gate` | A | `Write`, `Edit`, `MultiEdit`, `Bash` | `block` | 阻止在工件或提交/PR 文本中逐字引用已配置的说话者 |
| `memory-shell-write` | A | `Bash` | `block` | 阻止直接将 shell 写入内存存储 |
| `future-stamp` | A | `Write`, `Edit`, `MultiEdit` | `block` | 阻止工具时间戳超过 OS 时钟 5 分钟 |
| `release-reminder` | B | `Bash` | `warn` | 提醒在 `npm publish`、`gh release create` 或 `git push --tags` 之前 |

**配置文件（`~/.ai-loadout/profiles.json`、环境变量 `AI_LOADOUT_PROFILES_PATH`、`AI_LOADOUT_STORE`）：**

唯一的内置配置是 `default`。全局 `refresh` 和 `doctor` 通过优先级 `--store <dir>` > `AI_LOADOUT_STORE` > `defaultStore` 在 `profiles.json` 中解析默认存储，如果未配置任何存储，则会拒绝（使用 `DEFAULT_STORE_REQUIRED`）；它们绝不会从 `cwd` 继承。最长匹配的 `cwd` 前缀会选择活动配置，并可选地覆盖存储/回复/规则：

```json
{
  "defaultStore": "/stores/global/memory",
  "profiles": {
    "/repos/docs-site": { "profile": "docs", "store": "/stores/docs/memory" },
    "/repos/release-bot": { "profile": "release", "store": "/stores/release/memory" }
  },
  "repliesDir": "/var/log/review-replies",
  "rules": {
    "unreviewed-merge": {
      "action": { "docs": "off", "release": "warn" },
      "memory": { "release": "release-merge-policy" },
      "skill": "release-checklist",
      "note": { "release": "Verify changelog and release tag alignment before merging." }
    },
    "quote-gate": {
      "action": { "docs": "warn", "release": "block" }
    }
  },
  "ruleAliases": {
    "legacy-quote-rule": "quote-gate"
  },
  "quoteGate": {
    "speakers": ["He", "She", "They", "the User", "Maintainer"],
    "namedSpeakers": ["Maintainer"],
    "allowlistSuffixes": ["docs/quote-policy.md"]
  }
}
```

## 安装

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

内核也可以作为库导入——`@mcptoolshop/ai-loadout` 暴露 `planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad` 和调度表类型。

## 文档

- **[手册](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**——概述、安装、架构、命令参考、仪式以及从旧包迁移。
- **[仓库](https://github.com/mcp-tool-shop-org/loadout-os)**——源代码、路线图和问题。

## 为什么要整合

分解为秘密（Parnas 1972）对于 N 个人的团队来说是一个简洁的答案。对于一个单独的操作员和一个 LLM 团队来说，它在操作上是无效的：多仓库工作将代理的上下文分散到不同的会话中，未发布的适配器会损坏（只有内核才会发布），并且进展会序列化到不同的仓库中。一个带有单个 CLI 的命名伞形仓库可以为操作员提供服务。

## 状态

已发布。**`@mcptoolshop/loadout-os`** 已发布到 npm（公共仓库），并将内核、两个适配器（内存 + 规则）以及实时运行时钩子整合到一个命令行界面中——使用 `npm install -g @mcptoolshop/loadout-os` 进行安装。它取代了三个旧版本软件包，这些软件包已停止维护：内核 `@mcptoolshop/ai-loadout` 已在 npm 上标记为已弃用（仍然可以安装，但不再进行进一步的维护）；`claude-memories` 和 `claude-rules` 仅用于本地，现已停止使用。所有新的工作都将在此处进行。

## 信任模型

loadout-os 完全在您的机器上运行。没有网络调用，没有遥测数据，也没有账户。

- **它访问的数据（仅限本地）：**您的内存存储（`MEMORY.md` + 主题文件）、您的指令文件（`CLAUDE.md` + `.claude/rules/`）、生成的调度索引（位于存储旁边）、全局解析器索引（`~/.ai-loadout/index.json`）、项目解析器索引（`<project>/.claude/loadout/index.json`）以及只追加的使用日志（`~/.ai-loadout/usage.jsonl`）。
- **它不访问的数据：**没有网络数据传输，没有遥测数据，没有远程服务，没有凭据或密钥。没有任何数据会被读取、存储或传输到上述本地磁盘路径之外。
- **所需的权限：**仅限本地文件系统。`doctor` 和 `report` 仅进行读取（它们不会进行写入）。唯一的写入操作是索引文件、交互式 `rules split` 输出以及使用日志——所有这些都在上述预期的本地位置中。不可逆的写入操作（`refresh` 发布实时全局或项目索引）受到验证失败时的“andon halt”（紧急停止）和 `<dest>.bak` 补偿器的保护。提示和会话启动运行时钩子采用“fail-open”（失败时允许）策略：所有错误路径都会退出 `0`，因此它们永远不会阻止提示。

完整的威胁模型和报告流程：[SECURITY.md](./SECURITY.md)。

## 许可证

MIT——与所有上游源代码一致。

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
