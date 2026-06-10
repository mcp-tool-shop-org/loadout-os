<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

CLAUDE.md ファイルを軽量化しましょう。

`claude-rules` は、[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 用のディスパッチテーブルジェネレーターおよびインストラクションファイル最適化ツールです。 これは、肥大化したインストラクションファイルを、常にロードされる小さなルーティングインデックスと、必要に応じてロードされるトピック固有のルールファイルに分割し、セッションごとにコンテキストのトークン数を削減します。

## 問題点

CLAUDE.md ファイルは、時間の経過とともに肥大化します。 1行ごとに、セッションごとにトークンが消費されます。たとえ重要でなくても。 300行のインストラクションファイルは、モデルが持つすべての思考に対して、一種の負担となります。

## 解決策

3つのレイヤー、曖昧さはありません。

| レイヤー | ファイル | ロード |
|-------|------|--------|
| オペレーターコンソール | `CLAUDE.md` | 常に（軽量インデックス） |
| ディスパッチテーブル | `.claude/rules/index.json` | 常に（機械可読） |
| ルールペイロード | `.claude/rules/*.md` | オンデマンド |

各ルールファイルは、フロントマターとして独自のルーティングメタデータを持ちます。

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

エージェントが「CI」または「ワークフロー」に言及するタスクを検出すると、関連するルールファイルを読み込みます。 それ以外のファイルはロードされません。

## インストール

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## 使い方

### 分析

CLAUDE.md のセクションを評価し、抽出できるものを確認します。

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

### 分割

インタラクティブな抽出：各セクションを抽出する前に、承認する必要があります。

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

提案された各抽出について、プレビュー、推奨されるファイル名、キーワード、および優先度が表示されます。 各項目を承認またはスキップできます。

### 検証

ルールディレクトリの健全性をチェックします。

```bash
claude-rules validate
```

チェック項目： 参照ファイルの欠落、孤立したルールファイル、フロントマターの不整合、ドメインルールにおける空のキーワード、重複するID。

### 統計

システムの動作状況を確認します。

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

## 優先度

| 優先度 | 動作 | 例 |
|------|----------|---------|
| `core` | 常に CLAUDE.md にインラインで記述 | 「証拠があるまで正しいと仮定する」 |
| `domain` | タスクのキーワードに一致する場合にロード | CI の編集時に GitHub Actions のルールをロード |
| `manual` | 自動ロードされず、明示的な参照が必要 | プラットフォーム固有の注意点 |

## ルーティングの仕組み

エージェントは、CLAUDE.md にあるディスパッチテーブルを参照し、2つのシグナルによってルールファイルをロードするように促されます。

1. **意味的な一致**：タスクが「公開」または「CI」に言及している。
2. **明示的な指示**：CLAUDE.md が「計画または編集を行う前に、そのルールファイルを読み込んでください」と記述している。

これは、エージェントのループに対するヒントシステムであり、魔法ではありません。 キーワードのマッチングと明示的な指示の組み合わせによって、信頼性が高まります。

## 重要な点

- 抽出された各セクションは、CLAUDE.md に 1 行の概要を残します。
- すべての `domain`/`manual` ルールは `index.json` に存在します。
- すべての `core` ルールはインラインで保持され、ファイルにのみ抽出されることはありません。
- フロントマターが真実の源であり、`index.json` はそれから派生します。
- パーサーは、ATX ヘッダー (`##`, `###`) でのみ分割を行います。

## セキュリティ

このツールは、ローカルの Markdown ファイルと JSON ファイルのみを読み書きします。 ネットワークリクエストを行ったり、テレメトリを収集したり、外部サービスにアクセスしたりすることはありません。

### 脅威モデル

| 脅威 | 対策 |
|--------|------------|
| 不適切な分割によるデータ損失 | インタラクティブな承認 + `--dry-run` モード |
| 不正なルールファイル | `validate` コマンドで構造的な問題はすべて検出されます。 |
| 古いインデックス | `validate` は、フロントマターと `index.json` の間の不整合を検出します。 |

完全なセキュリティポリシーについては、[SECURITY.md](SECURITY.md) を参照してください。

---

[MCP Tool Shop](https://mcp-tool-shop.github.io/) が作成しました。
