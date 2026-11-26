<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**AIコーディングエージェント向けのナレッジOS。** 1つのCLIで、各セッションの開始時にすべてのメモリファイルとルールをコンテキストウィンドウにダンプするのではなく、必要なときに適切なコンテキストをモデルにルーティングします。

指示ファイルとメモリストアは、制限なく増加します。各行は、現在のタスクに関係があるかどうかに関わらず、すべてのプロンプトでトークンを消費します。loadout-osは、常にロードされた小さなディスパッチインデックスを保持し、メモリのトピック、ルールファイルなどの大きなペイロードは、タスクのキーワードが一致した場合にのみロードします。これは、ゲームの装備を準備するようなものです。エージェントに、今後のミッションに必要な知識を正確に与えます。

## 内容

loadout-osは、1つの`loadout-os`バイナリの下に4つの要素を統合します。

| 要素 | 機能 |
|---|---|
| **Kernel** (knowledge router) | 決定的なキーワード/パターン照合、階層的なレイヤー化されたリゾルバー（グローバル→組織→プロジェクト→セッション）、およびエージェントのランタイムコントラクト。コアエントリは常にロードされます。ドメインエントリは、一致した場合にロードされます。手動エントリは、明示的な検索時にロードされます。 |
| **Memories adapter** | `MEMORY.md`ストア（およびリンクされた`index-*.md`または`metadata.loadout_role: subindex`サブインデックス）を、機械可読なディスパッチテーブルに変換し、lint（ローダーの切り捨て制限は180行/24KB。デフォルトでは警告、`--max-lines`/`--max-bytes`、フロントマター`metadata.enforce_limits: true`、または`.loadout.json`を介してオプトインした場合にエラー。さらに、ファイルが見つからない、サブインデックスにまたがる孤立エントリ、古い箇条書きの要約、重複、長すぎるエントリ）。 |
| **Rules adapter** | 肥大化した`CLAUDE.md`を、常にロードされたコンパクトなインデックスと、必要に応じてロードされるルールファイルに分割し、インデックスに対してフロントマターを検証します。 |
| **Runtime hooks** | `UserPromptSubmit`ポインタールーター（`loadout-hook.mjs`、グローバル+プロジェクトレイヤーを公正なシェアキャップとサブインデックスの優先順位でマージ）、`hook session-start`（UTF-8ボードの挿入+古さのチェックとシェル編集によるリフレッシュ）、`hook pre-compact`（圧縮前の古さの警告）、`hook post-write`（`PostToolUse`バリデーター+プロジェクトのリフレッシュ）、および`hook pre-tool`（`PreToolUse`レイヤーA/Bガード+決定ロガー）。 |

さらに、システムを適切に維持するための3つの儀式があります。**`refresh`**（ディスパッチインデックスをグローバルまたは`--project <root>`に再生成→検証→公開。`.bak`コンペンセーター、OSファイルロック、およびオプションの`--snapshot-repo`/`--mirror-repo`を使用）、**`doctor`**（トライアドチェックを含む読み取り専用のヘルス画面）、および**`report`**（使用状況/不要なエントリ/トークン予算の可視化）。

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

> **名前の衝突は、ネームスペースによって解決されます。** フラットな`validate <index>`は、カーネルのインデックス構造バリデーターです。ストアとルールのリンターは、ネームスペース（`memories validate <MEMORY.md>`と`rules validate`）で区切られているため、これら3つは共存できます。各コマンドの概要、引数、および終了コードについては、`loadout-os <command> --help`を実行してください。

## プロジェクトレイヤーのメモリとClaudeコードフックの配線

各プロジェクトプロファイルは、メモリストア（`loadout-os refresh --store <store> --project <root>`）から構築された独自の`.claude/loadout/index.json`を保持できます。

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
- `core`エントリで`metadata.loadout_inject: session-start`が設定されている場合、それらは完全に`SessionStart`に挿入されます（また、ルーティングされたエントリが不足しないように、各プロンプトのポインタースロットから除外されます）。
- **エントリIDのソース（`idSource: "title" | "name"`）：** 明示的なフロントマター`id:`が常に優先されます。`id:`が省略された場合、グローバル/`--dest`ストアはデフォルトで`title`（`MEMORY.md`のケバブケースの箇条書きタイトル、`v1.0.4`エントリIDを保持）、一方、`--project`ストアはデフォルトで`name`（ケバブケースのフロントマター`name:`）になります。ストアごとに`<store>/.loadout.json`（`{ "idSource": "title" | "name" }`）または`MEMORY.md`フロントマター（`metadata.id_source: title | name`）、または各呼び出しごとに`--id-source title|name`を`refresh`および`memories`コマンドで使用してオーバーライドします（ストアの設定よりも優先されます）。

### 2. 例：`.claude/settings.local.json`フックブロック

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

> **シェル編集に関する注意：** シェル（`Bash`/`PowerShell`）を介してメモリファイルに加えた編集は、`PostToolUse`（`Write|Edit`）をスキップします。組み込みのフォールバックとして、`loadout-os hook session-start`は、いずれかの`<store>/*.md`ファイルがプロジェクトの`index.json`よりも新しいかどうかを確認し、プロジェクトインデックスを自動的にリフレッシュします（検証に失敗した場合は警告します）。

### 3. PreToolUseフックと`profiles.json`

`loadout-os hook pre-tool`は、実行前にプロセス内のツール呼び出しをガードし、読み取り専用のツールと読み取り専用のBashパイプラインをサイレントに渡します（`exit 0`）、アクティブなプロファイルごとにレイヤーA/Bルールテーブルを評価し、ハッシュ化された決定（`input_hash`、生のコマンドテキストは記録しません）を`~/.ai-loadout/hook-decisions.jsonl`にログ記録し、ブロックが一致する前にオープンに失敗し、ブロックルールが一致するとクローズして失敗します（`exit 2`+標準エラー出力のみ）。

**組み込みルール：**

| ルールID | レイヤー | ツール | デフォルトアクション | 目的 |
|---|---|---|---|---|
| `unreviewed-merge` | A | `Bash` | `warn` | 記録されたレビューパス（`PASS at <head8>`）をマージする前に、確認するように促します。 |
| `quote-gate` | A | `Write`, `Edit`, `MultiEdit`, `Bash` | `block` | アーティファクトまたはコミット/PRテキストで、構成されたスピーカーをそのまま引用することをブロックします。 |
| `memory-shell-write` | A | `Bash` | `block` | メモリストアへの直接的なシェル書き込みをブロックします。 |
| `future-stamp` | A | `Write`, `Edit`, `MultiEdit` | `block` | OSクロックより5分以上先のタイムスタンプをツールで付けることをブロックします。 |
| `release-reminder` | B | `Bash` | `warn` | `npm publish`、`gh release create`、または`git push --tags`を実行する前に、促します。 |

**プロファイルと構成（`~/.ai-loadout/profiles.json`、環境変数`AI_LOADOUT_PROFILES_PATH`、`AI_LOADOUT_STORE`）：**

組み込みのプロファイルは`default`のみです。グローバル`refresh`と`doctor`は、デフォルトのメモリストアを優先順位`--store <dir>`>`AI_LOADOUT_STORE`>`defaultStore`で解決します（`profiles.json`）。いずれも構成されていない場合は、拒否します（`DEFAULT_STORE_REQUIRED`）。`cwd`からは派生しません。最長一致の`cwd`プレフィックスが、アクティブなプロファイルとオプションのストア/レスポンス/ルールオーバーライドを選択します。

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

## インストール

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

カーネルは、ライブラリとしてもインポートできます。`@mcptoolshop/ai-loadout`は、`planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad`、およびディスパッチテーブル型を公開します。

## ドキュメント

- **[ハンドブック](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** - 概要、インストール、アーキテクチャ、コマンドリファレンス、儀式、およびレガシーパッケージからの移行。
- **[リポジトリ](https://github.com/mcp-tool-shop-org/loadout-os)** - ソース、ロードマップ、および課題。

## 統合の理由

秘密ごとに分割する（Parnas 1972）は、N人の人間のチームにとって最適な解決策でした。単独のオペレーターとLLMクルーにとっては、操作上問題があります。マルチリポジトリの作業は、エージェントのコンテキストをセッション間で断片化し、公開されていないアダプターは腐敗し（カーネルのみがリリースされる）、進歩はリポジトリ間でシリアル化されます。1つの名前付きの傘リポジトリと1つのCLIが、オペレーターに役立ちます。

## ステータス

出荷しました。**`@mcptoolshop/loadout-os`** は npm（パブリック）に公開され、カーネル、2つのアダプター（メモリとルール）、およびライブランタイムフックを1つのCLIに統合しています。インストールするには、`npm install -g @mcptoolshop/loadout-os`を使用します。これに置き換えられる3つの旧バージョンのパッケージは廃止されました。カーネル `@mcptoolshop/ai-loadout` は npm で非推奨となっています（まだインストール可能ですが、これ以上の更新は行われません）。`claude-memories` と `claude-rules` はローカルでのみ使用可能で、現在は使用されていません。すべての新しい作業はここに集約されます。

## 信頼モデル

loadout-os は完全にローカルマシン上で実行されます。ネットワーク接続、テレメトリ、アカウントは一切使用しません。

- **アクセスするデータ（ローカルのみ）：** メモリストア（`MEMORY.md` + トピックファイル）、指示ファイル（`CLAUDE.md` + `.claude/rules/`）、ストアの隣に生成されるディスパッチインデックス、グローバルリゾルバーインデックス（`~/.ai-loadout/index.json`）、プロジェクトリゾルバーインデックス（`<project>/.claude/loadout/index.json`）、および追加専用の使用ログ（`~/.ai-loadout/usage.jsonl`）。
- **アクセスしないデータ：** ネットワーク経由でのデータ送信、テレメトリ、リモートサービス、認証情報または秘密鍵は一切使用しません。上記のローカルディスクパスからデータを読み取ったり、保存したり、送信したりすることはありません。
- **必要な権限：** ローカルファイルシステムのみ。`doctor` と `report` は読み取り専用です（書き込みは行いません）。書き込みは、インデックスファイル、インタラクティブな `rules split` の出力、および使用ログのみで、すべて上記の想定されるローカルの場所に保存されます。不可逆的な書き込み（`refresh`、ライブのグローバルまたはプロジェクトインデックスの公開）は、検証失敗時にアンドンによる停止が実行され、`<dest>.bak` による補正が行われます。プロンプトとセッション開始時のランタイムフックは、エラーが発生しても処理を続行するように設計されており、すべてのエラーパスは `0` を終了するため、プロンプトをブロックすることはありません。

完全な脅威モデルと報告プロセス：[SECURITY.md](./SECURITY.md)。

## ライセンス

MIT — すべてのアップストリームソースと一致します。

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
