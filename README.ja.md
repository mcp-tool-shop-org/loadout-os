<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**AIコーディングエージェントのためのナレッジOS。** 各セッションの開始時にすべてのメモリファイルとルールをコンテキストウィンドウにダンプするのではなく、必要なときに適切なコンテキストをモデルにルーティングする単一のCLI。

指示ファイルとメモリストアは無限に増加します。各行は、タスクに関係があるかどうかに関わらず、すべてのプロンプトでトークンコストが発生します。loadout-osは、常にロードされている小さなディスパッチインデックスを保持し、メモリのトピックやルールファイルなどの大きなペイロードは、タスクのキーワードが一致した場合にのみロードします。ゲームの装備品のように考えてください。エージェントに必要な知識だけを、今後のミッションのために装備させます。

## 内容

loadout-osは、1つの`loadout-os`バイナリの下に4つの要素を統合します。

| 要素 | 機能 |
|---|---|
| **Kernel** (knowledge router) | 決定的なキーワード/パターンマッチャー、階層化されたレイヤー解決モジュール（グローバル→組織→プロジェクト→セッション）、およびエージェントのランタイムコントラクト。コアのエントリーは常にロードされます。ドメインのエントリーは一致した場合にロードされます。手動エントリーは明示的な検索時にロードされます。 |
| **Memories adapter** | `MEMORY.md`ストアを機械可読なディスパッチテーブルに変換し、lint（欠落ファイル、孤立ファイル、重複、長すぎるエントリー）を実行します。 |
| **Rules adapter** | 肥大化した`CLAUDE.md`を、常にロードされている軽量のインデックスと、必要に応じてロードされるルールファイルに分割し、フロントマターがインデックスに対して検証されます。 |
| **Runtime hook** | プロンプトに関連するエントリーへの最大5行（最大200トークン）を挿入する`UserPromptSubmit`フック。フェイルセーフ：すべてのエラーパスは0で終了するため、壊れたフックがプロンプトをブロックすることはありません。 |

さらに、システムの状態を維持するための3つの儀式があります。**`refresh`**（ディスパッチインデックスを再生成→検証→公開し、バックアップ補正を行います）、**`doctor`**（読み取り専用の8項目の健全性チェックを実行します）、および**`report`**（使用状況/未使用エントリー/トークン予算に関する可視化を提供します）。

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

> **名前の衝突は、ネームスペースによって解決されます。** フラットな`validate <index>`は、カーネルのインデックス構造バリデーターです。ストアとルールのリンターはネームスペース化されています（`memories validate <MEMORY.md>`および`rules validate`）。これにより、すべてが共存できます。`loadout-os <command> --help`を実行すると、コマンドごとの概要、引数、および終了コードが表示されます。

## インストール

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

カーネルはライブラリとしてもインポート可能です。`@mcptoolshop/ai-loadout`は、`planLoad`、`matchLoadout`、`resolveLoadout`、`recordLoad`、およびディスパッチテーブルの型を公開します。

## ドキュメント

- **[ハンドブック](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — 概要、インストール、アーキテクチャ、コマンドリファレンス、儀式、およびレガシーパッケージからの移行。
- **[リポジトリ](https://github.com/mcp-tool-shop-org/loadout-os)** — ソースコード、ロードマップ、および課題。

## 統合の理由

秘密に基づいて分解（Parnas 1972）は、N人の人間のチームにとって最適な解決策でした。単独のオペレーターとLLMクルーにとっては、操作的に問題があります。マルチリポジトリでの作業は、エージェントのコンテキストをセッション間で断片化し、公開されていないアダプターが劣化します（カーネルのみがリリースされる）、そして進歩はリポジトリ全体でシリアル化されます。1つの名前付きの傘リポジトリと1つのCLIがオペレーターに役立ちます。完全な推論は、正規のメモリストア（`feedback_consolidate_when_cant_juggle_repos.md`）にあります。

## ステータス

出荷しました。**`@mcptoolshop/loadout-os`** を npm（公開版）に公開し、カーネル、2つのアダプター（メモリとルール）、およびライブランタイムフックを1つのCLIに統合しました。インストールするには、`npm install -g @mcptoolshop/loadout-os` を使用します。このパッケージによって置き換えられた3つの旧バージョンのパッケージは廃止されました。カーネル `@mcptoolshop/ai-loadout` は npm で非推奨となっています（まだインストール可能ですが、これ以上の更新はありません）。`claude-memories` と `claude-rules` はローカルでのみ使用でき、現在はサポートを終了しています。今後のすべての新機能はここに統合されます。

## 信頼モデル

loadout-osは完全にローカルマシン上で実行されます。ネットワーク呼び出し、テレメトリー、またはアカウントはありません。

- **アクセスするデータ（ローカルのみ）：** メモリストア（`MEMORY.md` + トピックファイル）、指示ファイル（`CLAUDE.md` + `.claude/rules/`）、ストアの隣に生成されたディスパッチインデックス、グローバルリゾルバーインデックス（`~/.ai-loadout/index.json`）、および追加専用の使用状況ログ（`~/.ai-loadout/usage.jsonl`）。
- **アクセスしないデータ：** ネットワークへの送信、テレメトリー、リモートサービス、資格情報または秘密。ローカルディスクの上記のパスから読み取り、保存、または送信されるものは何もありません。
- **必要な権限：** ローカルファイルシステムのみ。`doctor`と`report`は純粋な読み取り専用です（書き込みは行いません）。唯一の書き込みは、インデックスファイル、インタラクティブな`rules split`出力、および使用状況ログであり、すべて上記の予想されるローカル場所に保存されます。不可逆的な書き込み（ライブグローバルインデックスを公開する`refresh`）は、検証失敗時のアンドンハルトと`<dest>.bak`補正によって保護されています。ランタイムフックはフェイルセーフです。すべてのエラーパスは`0`で終了するため、プロンプトをブロックすることはありません。

完全な脅威モデルとレポートプロセス：[SECURITY.md](./SECURITY.md)。

## ライセンス

MIT — すべてのアップストリームソースと一致します。
