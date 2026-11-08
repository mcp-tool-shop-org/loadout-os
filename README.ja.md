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

**AIコーディングエージェントのためのナレッジOS。** 1つのCLIで、必要なコンテキストをオンデマンドでモデルにルーティングします。各セッションの開始時に、すべてのメモリファイルとルールをコンテキストウィンドウに一括で投入するのではなく。

指示ファイルとメモリストアは、制限なく増加します。各行は、その行が現在のタスクに関連するかどうかに関わらず、すべてのプロンプトでトークンを消費します。loadout-osは、常にロードされた小さなディスパッチインデックスを保持し、メモリのトピック、ルールファイルなどの大きなペイロードは、タスクのキーワードが一致した場合にのみロードします。これは、ゲームの装備を準備するようなものです。エージェントに、今後のミッションに必要な知識を正確に与えます。

## 内容

loadout-osは、1つの`loadout-os`バイナリの下に4つの要素を統合します。

| 要素 | その機能 |
|---|---|
| **Kernel** (knowledge router) | 決定的なキーワード/パターン照合、階層的なレイヤー化されたリゾルバー（グローバル→組織→プロジェクト→セッション）、およびエージェントのランタイムコントラクト。コアエントリは常にロードされます。ドメインエントリは、一致した場合にロードされます。手動エントリは、明示的な検索時にロードされます。 |
| **Memories adapter** | `MEMORY.md`ストア（およびリンクされた`index-*.md`または`metadata.loadout_role: subindex`サブインデックス）を、機械可読なディスパッチテーブルに変換し、lint（ローダーの切り捨て制限は180行/24KB。デフォルトでは警告、`--max-lines`/`--max-bytes`、フロントマター`metadata.enforce_limits: true`、または`.loadout.json`を通じてオプトインした場合にエラー。さらに、ファイルが見つからない、サブインデックスにまたがる孤立エントリ、古い箇条書きの要約、重複、長すぎるエントリ）。 |
| **Rules adapter** | 肥大化した`CLAUDE.md`を、常にロードされたコンパクトなインデックスと、オンデマンドのルールファイルに分割し、インデックスに対してフロントマターを検証します。 |
| **Runtime hooks** | `UserPromptSubmit`ポインタールーター（`loadout-hook.mjs`、グローバル+プロジェクトレイヤーを公平なシェアキャップとサブインデックスの優先度でマージ）、`hook session-start`（UTF-8ボードの挿入+古さのチェックとシェル編集によるリフレッシュ）、`hook pre-compact`（圧縮前の古さの警告）、および`hook post-write`（`PostToolUse`バリデーター+プロジェクトのリフレッシュ）。 |

さらに、システムを適切に維持するための3つの儀式があります。**`refresh`**（ディスパッチインデックスをグローバルまたは`--project <root>`に再生成→検証→公開。`.bak`コンペンセーター、OSファイルロック、およびオプションの`--snapshot-repo`/`--mirror-repo`を使用）、**`doctor`**（読み取り専用の8つのチェックによる健全性チェック）、および**`report`**（使用状況/不要なエントリ/トークン予算の可視化）。

## コマンドサーフェス

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

> **名前の衝突は、ネームスペースによって解決されます。** フラットな`validate <index>`は、カーネルのインデックス構造バリデーターです。ストアとルールのリンターは、ネームスペース（`memories validate <MEMORY.md>`と`rules validate`）を使用しているため、これら3つは共存できます。各コマンドの概要、引数、および終了コードについては、`loadout-os <command> --help`を実行してください。

## プロジェクトレイヤーのメモリとClaudeコードフックの配線

各プロジェクトのシートは、そのメモリストア（`loadout-os refresh --store <store> --project <root>`）から構築された独自の`.claude/loadout/index.json`を保持できます。

### 1. トピックとボードのフロントマター

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

- サブインデックス（`index-*.md`または`metadata.loadout_role: subindex`を含むファイル）は、`subindex: true`を使用して、ディスパッチインデックスに1レベル展開されます。
- `index-archive.md`（または`metadata.loadout_default_priority: manual`を含むサブインデックス）は、トピックファイルがフロントマターで明示的に`priority:`を設定しない限り、エントリをデフォルトで`priority: "manual"`に設定します。
- `core`エントリ（`metadata.loadout_inject: session-start`を含む）は、`SessionStart`で完全に挿入されます（また、ルーティングされたエントリが不足しないように、各プロンプトのポインタースロットから除外されます）。
- **エントリIDのソース（`idSource: "title" | "name"`）：** 明示的なフロントマター`id:`が常に優先されます。`id:`が省略された場合、グローバル/`--dest`ストアはデフォルトで`title`（`MEMORY.md`のケバブケースの箇条書きタイトル、`v1.0.4`エントリIDを保持）、一方、`--project`ストアはデフォルトで`name`（ケバブケースのフロントマター`name:`）になります。ストアごとに`<store>/.loadout.json`（`{ "idSource": "title" | "name" }`）または`MEMORY.md`フロントマター（`metadata.id_source: title | name`）で、または各呼び出しごとに`refresh`および`memories`コマンドで`--id-source title|name`を使用してオーバーライドします（ストアの設定よりも優先されます）。

### 2. 例となる`.claude/settings.local.json`フックブロック

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

> **シェル編集に関する注意：** シェル（`Bash`/`PowerShell`）を通じてメモリファイルに加えた編集は、`PostToolUse`（`Write|Edit`）をスキップします。組み込みのフォールバックとして、`loadout-os hook session-start`は、どの`<store>/*.md`ファイルもプロジェクトの`index.json`よりも新しいかどうかを確認し、プロジェクトインデックスを自動的にリフレッシュします（検証に失敗した場合は警告します）。

## インストール

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

カーネルは、ライブラリとしてもインポートできます。`@mcptoolshop/ai-loadout`は、`planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad`、およびディスパッチテーブルの型を公開します。

## ドキュメント

- **[ハンドブック](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** - 概要、インストール、アーキテクチャ、コマンドリファレンス、儀式、およびレガシーパッケージからの移行。
- **[リポジトリ](https://github.com/mcp-tool-shop-org/loadout-os)** - ソース、ロードマップ、および課題。

## 統合の理由

秘密ごとに分割する（Parnas 1972）は、N人の人間のチームにとって最適な解決策でした。単独のオペレーターとLLMクルーにとっては、運用上問題があります。マルチリポジトリの作業は、エージェントのコンテキストをセッション間で断片化し、公開されていないアダプターは劣化し（カーネルのみがリリースされる）、進歩はリポジトリ間でシリアル化されます。1つの名前付きの包括的なリポジトリと1つのCLIが、オペレーターに役立ちます。

## ステータス

リリース済み。**`@mcptoolshop/loadout-os`**はnpm（パブリック）に公開されており、カーネル、2つのアダプター（メモリ+ルール）、およびライブランタイムフックを1つのCLIに統合しています。インストールするには、`npm install -g @mcptoolshop/loadout-os`を使用します。これに置き換えられる3つのレガシーパッケージは廃止されました。カーネル`@mcptoolshop/ai-loadout`はnpmで非推奨になりました（まだインストール可能ですが、それ以上の作業は行われません）。`claude-memories`と`claude-rules`はローカル専用であり、アーカイブされています。すべての新しい作業はここに統合されます。

## 信頼モデル

loadout-osは、完全にローカルマシン上で実行されます。ネットワーク呼び出し、テレメトリ、またはアカウントはありません。

- **アクセスするデータ（ローカルのみ）：** メモリストレージ（`MEMORY.md` + トピックファイル）、指示ファイル（`CLAUDE.md` + `.claude/rules/`）、ストレージの隣に生成されるディスパッチインデックス、グローバルリゾルバーインデックス（`~/.ai-loadout/index.json`）、プロジェクトリゾルバーインデックス（`<project>/.claude/loadout/index.json`）、および追加専用の利用ログ（`~/.ai-loadout/usage.jsonl`）。
- **アクセスしないデータ：** ネットワークへのデータ送信、テレメトリ、リモートサービス、認証情報や秘密鍵は一切使用しません。上記のローカルディスクパスからデータを読み込んだり、保存したり、送信したりすることはありません。
- **必要な権限：** ローカルファイルシステムのみ。`doctor`と`report`は読み取り専用です（書き込みは行いません）。書き込みは、インデックスファイル、インタラクティブな`rules split`の出力、および利用ログのみで、すべて上記の想定されるローカルの場所に保存されます。不可逆的な書き込み（`refresh`でライブのグローバルまたはプロジェクトインデックスを公開）は、検証失敗時にアンドンによる停止が実行され、`<dest>.bak`による補償が行われます。プロンプトとセッション開始時のランタイムフックは、エラーが発生しても処理を続行するように設計されており、すべてのエラーパスは`0`で終了するため、プロンプトをブロックすることはありません。

完全な脅威モデルと報告プロセス：[SECURITY.md](./SECURITY.md)。

## ライセンス

MIT — すべてのアップストリームソースと一致。

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
