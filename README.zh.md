<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**适用于 AI 代码生成代理的知识操作系统。** 一个 CLI，可根据需要将正确的上下文路由到模型——而不是在每个会话开始时将所有内存文件和规则都转储到上下文中。

您的指令文件和记忆存储无限增长。每一行都会占用令牌，无论它是否与当前任务相关。loadout-os 始终加载一个小型调度索引，并且仅在任务关键字匹配时才加载大型数据——内存主题、规则文件。将其视为游戏装备：为代理配备执行后续任务所需的精确知识。

## 内部包含的内容

loadout-os 在一个 `loadout-os` 二进制文件中统一了四个界面：

| 界面 | 其功能 |
|---|---|
| **Kernel** (knowledge router) | 确定性关键字/模式匹配器、分层分层解析器（全局 → 组织 → 项目 → 会话）以及代理运行时契约。核心条目始终加载；域条目在匹配时加载；手动条目在显式查找时加载。 |
| **Memories adapter** | 将 `MEMORY.md` 存储转换为机器可读的调度表并对其进行检查（缺少的文件、孤立项、重复项、过长的条目）。 |
| **Rules adapter** | 将一个庞大的 `CLAUDE.md` 文件拆分为一个精简的始终加载的索引以及按需加载的规则文件，并验证前置信息是否与索引匹配。 |
| **Runtime hook** | 一个 `UserPromptSubmit` 钩子，它会将最多 5 行指针（最多 200 个令牌）注入到与您的提示相关的条目中。容错处理：所有错误路径都以 0 退出，因此损坏的钩子永远不会阻止提示。 |

此外还有三个仪式来维护系统的可靠性：**`refresh`**（重新生成 → 验证 → 发布调度索引，并带有备份补偿器）、**`doctor`**（只读的 8 项健康检查）和 **`report`**（使用情况/无效条目/令牌预算的可观察性）。

## 命令界面

```
# Memory store adapter
loadout-os memories index    <MEMORY.md> [--lazy] [--json]
loadout-os memories validate <MEMORY.md> [--json]
loadout-os memories stats    <MEMORY.md> [--json]
loadout-os memories health   [path] [--json]

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

# Rituals + hook
loadout-os doctor [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>] # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]      # drive the runtime hook on a sample prompt
loadout-os refresh [--store <d>] [--dest <p>] [--dry-run]  # index → validate → publish
```

> **名称冲突，通过命名空间解决。** `validate <index>` 是内核的索引结构验证器。存储和规则检查程序都使用了命名空间——`memories validate <MEMORY.md>` 和 `rules validate`——因此这三个可以共存。运行 `loadout-os <command> --help` 以获取每个命令的摘要、参数和退出代码。

## 安装

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

内核也可以作为库导入——`@mcptoolshop/ai-loadout` 暴露了 `planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad` 和调度表类型。

## 文档

- **[手册](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**——概述、安装、架构、命令参考、仪式以及从旧版本软件包迁移。
- **[仓库](https://github.com/mcp-tool-shop-org/loadout-os)**——源代码、路线图和问题。

## 为什么进行整合

“按秘密分解”（Parnas 1972）对于一个由 N 个人类组成的团队来说，这是一个很好的解决方案。对于一个单独的操作员和一个 LLM 团队来说，它在操作上是无效的：多仓库工作会将代理的上下文分散到不同的会话中，未发布的适配器会损坏（只有内核才会发布），并且改进需要在不同的仓库中进行串行处理。一个带有单个 CLI 的命名伞形仓库可以为操作员提供服务。完整的推理记录在规范内存存储 (`feedback_consolidate_when_cant_juggle_repos.md`) 中。

## 状态

已发布。**`@mcptoolshop/loadout-os`** 已发布到 npm（公共），并将内核、两个适配器（内存 + 规则）以及实时运行时钩子合并到一个 CLI 中——使用 `npm install -g @mcptoolshop/loadout-os` 进行安装。它所取代的三个旧版本软件包已退役：内核 `@mcptoolshop/ai-loadout` 已在 npm 上弃用（仍然可以安装，但不再进行任何进一步的工作）；`claude-memories` 和 `claude-rules` 仅用于本地，并且已被存档。所有新工作都将在此处进行。

## 信任模型

loadout-os 完全在您的机器上运行。没有网络调用、没有遥测数据，也没有帐户。

- **它访问的数据（仅限本地）：** 您的内存存储 (`MEMORY.md` + 主题文件)、您的指令文件 (`CLAUDE.md` + `.claude/rules/`)、生成的调度索引（位于存储旁边）、全局解析器索引 (`~/.ai-loadout/index.json`) 以及追加日志 (`~/.ai-loadout/usage.jsonl`)。
- **它不访问的数据：** 没有网络出口，没有遥测数据，没有远程服务，也没有凭据或密钥。不会读取、存储或传输到上述本地磁盘路径之外的任何内容。
- **所需的权限：** 仅限本地文件系统。`doctor` 和 `report` 都是纯只读（它们永远不会写入）。唯一的写入操作是索引文件、交互式 `rules split` 输出以及使用日志——所有这些都在上述预期的本地位置中。不可逆的写入操作（`refresh` 发布实时全局索引）受到验证失败时的 andon 停止和 `<dest>.bak` 补偿器的保护。运行时钩子具有容错处理：所有错误路径都以 `0` 退出，因此它永远不会阻止提示。

完整的威胁模型和报告流程：[SECURITY.md](./SECURITY.md)。

## 许可证

MIT——与所有上游源代码匹配。
