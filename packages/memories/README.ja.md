<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Claude Code用のMEMORY.md最適化ツールおよびディスパッチテーブル生成ツール。

MEMORY.mdファイルを軽量化しましょう。claude-memoriesは、メモリファイルの内容を分析し、機械が読み取り可能なディスパッチテーブルを生成し、コンテキストの利用状況を表示します。

## 問題点

Claude Codeの自動メモリ機能により、コンテキストウィンドウを圧迫する巨大なMEMORY.mdファイルが生成されます。セッションごとに40K以上のトークンがメモリとして読み込まれますが、そのほとんどが現在のタスクには無関係です。

## 解決策

claude-memoriesは、メモリファイルをインデックス化し、ディスパッチテーブルを作成します。これにより、エージェントは必要なメモリの内容のみをロードし、不要な情報を読み込むことを回避できます。

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**98%の省資源化**を、31のトピックを持つメモリワークスペースで実現しました。

## インストール方法

```bash
npm install -g @mcptoolshop/claude-memories
```

## コマンド

### analyze

MEMORY.mdファイルの構造、参照、およびトークン使用量を分析します。

```bash
claude-memories analyze MEMORY.md
```

### index

メモリファイルからディスパッチテーブル（index.json）を生成します。

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

メモリファイルの構造上の問題をチェックします。

```bash
claude-memories validate MEMORY.md
```

チェック項目：トピックファイルがない、孤立ファイルがある、重複した参照がある、名前が空である。

### stats

トークン使用量ダッシュボードを表示します。

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

## 動作原理

1. MEMORY.mdファイルを解析し、トピックへの参照（矢印形式：`Name → path`）を抽出します。
2. 各トピックファイルを読み込み、見出しと本文からキーワードを抽出します。
3. ai-loadoutと互換性のあるLoadoutIndex（ディスパッチテーブル）を生成します。
4. 構造的な整合性を検証します（ファイルがない、孤立ファイルがある、重複がある）。

### 参照形式

MEMORY.mdのエントリは、以下の形式に従います。

```
Topic Name — description → `memory/topic-file.md`
```

箇条書き形式と箇条書きでない形式の両方がサポートされています。

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### フロントマター（オプション）

トピックファイルには、詳細な制御を行うためのフロントマターを含めることができます。

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

フロントマターがない場合、キーワードはトピック名と見出しから自動的に抽出されます。

## アーキテクチャ

claude-memoriesは、Knowledge OSスタックにおける**Layer 2アダプター**です。

| レイヤー | パッケージ | 役割 |
|-------|---------|------|
| カーネル | `@mcptoolshop/ai-loadout` | ルーティング、マッチング、検証 |
| アダプター | `@mcptoolshop/claude-rules` | CLAUDE.md最適化 |
| アダプター | `@mcptoolshop/claude-memories` | MEMORY.md最適化 |

同じカーネルを使用し、異なるドキュメントタイプを処理します。どちらも互換性のあるディスパッチテーブルを生成します。

## セキュリティ

- **ローカルのみ**: ネットワーク接続は不要、テレメトリーも行いません。
- **読み取り専用**: index.jsonファイルのみを書き込みます。MEMORY.mdファイルは変更しません。
- **決定論的**: 同じ入力に対しては、常に同じ出力が得られます。

脅威モデルについては、[SECURITY.md](SECURITY.md)を参照してください。

## ライセンス

MIT

---

開発：<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
