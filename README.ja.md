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

**AIコーディングエージェントのためのナレッジOS。** 1つのCLIで、必要なコンテキストをオンデマンドでモデルにルーティングします。各セッションの開始時に、すべてのメモリファイルとルールをコンテキストウィンドウに一括で投入するのではなく。

指示ファイルとメモリストアは、制限なく増加します。各行は、現在のタスクに関係があるかどうかに関わらず、すべてのプロンプトでトークンを消費します。loadout-osは、常にロードされた小さなディスパッチインデックスを保持し、メモリのトピック、ルールファイルなどの大きなペイロードは、タスクのキーワードが一致した場合にのみロードします。ゲームの装備品を考えるように、エージェントに、今後のミッションに必要な知識を正確に装備させます。

## 内容

loadout-osは、1つの`loadout-os`バイナリの下に4つの要素を統合します。

| 要素 | 機能 |
|---|---|
| **Kernel** (knowledge router) | 決定的なキーワード/パターンマッチャー、階層型レイヤー化されたリゾルバー（グローバル→組織→プロジェクト→セッション）、およびエージェントのランタイムコントラクト。コアエントリは常にロードされます。ドメインエントリは、一致した場合にロードされます。手動エントリは、明示的な検索時にロードされます。 |
| **Memories adapter** | `MEMORY.md`ストアを、機械可読なディスパッチテーブルに変換し、lint（欠落ファイル、孤立ファイル、重複、長すぎるエントリ）を実行します。両方のインデックススタイルを読み取ります。Claude Code独自の`- [Title](file.md) — hook`リンクと`Name — description → path`アロー参照。 |
| **Rules adapter** | 肥大化した`CLAUDE.md`を、常にロードされた軽量なインデックスと、オンデマンドのルールファイルに分割し、インデックスに対してフロントマターを検証します。 |
| **Runtime hook** | プロンプトに関連するエントリに、最大5行のポインタ（最大200トークン）を挿入する`UserPromptSubmit`フック。フェイルセーフ：すべてのエラーパスは0で終了するため、壊れたフックがプロンプトをブロックすることはありません。 |

さらに、システムを正常に維持するための3つの儀式があります。**`refresh`**（ディスパッチインデックスを再生成→検証→公開し、バックアップ補正を行う）、**`doctor`**（読み取り専用の8つのチェックによる健全性画面）、および**`report`**（使用状況/未使用エントリ/トークン予算の可視化）。

## コマンドサーフェス

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

> **名前の衝突は、ネームスペースによって解決されます。** フラットな`validate <index>`は、カーネルのインデックス構造バリデーターです。ストアとルールのリンターは、ネームスペース（`memories validate <MEMORY.md>`と`rules validate`）で区切られているため、すべてが共存できます。`loadout-os <command> --help`を実行すると、コマンドごとの概要、引数、および終了コードが表示されます。

## インストール

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

カーネルは、ライブラリとしてもインポートできます。`@mcptoolshop/ai-loadout`は、`planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad`、およびディスパッチテーブル型を公開します。

## ドキュメント

- **[ハンドブック](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — 概要、インストール、アーキテクチャ、コマンドリファレンス、儀式、およびレガシーパッケージからの移行。
- **[リポジトリ](https://github.com/mcp-tool-shop-org/loadout-os)** — ソースコード、ロードマップ、および課題。

## 統合の理由

秘密に基づいて分割する（Parnas 1972）は、N人の人間のチームにとって適切な解決策でした。単独のオペレーターとLLMクルーにとっては、運用上問題があります。マルチリポジトリの作業は、エージェントのコンテキストをセッション間で断片化し、未公開のアダプターは劣化し（カーネルのみがリリースされる）、進歩はリポジトリ間でシリアル化されます。1つの名前付きの包括的なリポジトリと1つのCLIが、オペレーターに役立ちます。

## ステータス

リリース済み。**`@mcptoolshop/loadout-os`**はnpm（パブリック）に公開されており、カーネル、2つのアダプター（メモリ+ルール）、およびライブランタイムフックを1つのCLIに統合しています。`npm install -g @mcptoolshop/loadout-os`でインストールしてください。これに置き換えられる3つのレガシーパッケージは廃止されました。カーネル`@mcptoolshop/ai-loadout`はnpmで非推奨になりました（まだインストール可能ですが、それ以上の作業は行われません）。`claude-memories`と`claude-rules`はローカル専用であり、アーカイブされています。すべての新しい作業は、ここに統合されます。

## 信頼モデル

loadout-osは、完全にローカルマシン上で実行されます。ネットワーク呼び出し、テレメトリ、またはアカウントはありません。

- **アクセスするデータ（ローカルのみ）：** メモリストア（`MEMORY.md` + トピックファイル）、指示ファイル（`CLAUDE.md` + `.claude/rules/`）、ストアの隣に生成されたディスパッチインデックス、グローバルリゾルバーインデックス（`~/.ai-loadout/index.json`）、および追記専用の使用状況ログ（`~/.ai-loadout/usage.jsonl`）。
- **アクセスしないデータ：** ネットワークへの送信、テレメトリ、リモートサービス、資格情報または秘密。ローカルディスクパスのいずれにも、読み取り、保存、または送信されるデータはありません。
- **必要な権限：** ローカルファイルシステムのみ。`doctor`と`report`は純粋な読み取り専用です（書き込みは行いません）。書き込みは、インデックスファイル、インタラクティブな`rules split`出力、および使用状況ログのみで、すべて上記の予想されるローカルの場所に保存されます。不可逆的な書き込み（`refresh`でライブグローバルインデックスを公開）は、検証失敗時のアンドンハルトと`<dest>.bak`補正によって保護されています。ランタイムフックはフェイルセーフです。すべてのエラーパスは`0`で終了するため、プロンプトをブロックすることはありません。

完全な脅威モデルとレポートプロセス：[SECURITY.md](./SECURITY.md)。

## ライセンス

MIT — すべての上流ソースと一致します。

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
