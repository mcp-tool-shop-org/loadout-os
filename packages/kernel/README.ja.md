<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-loadout/readme.png" width="400" alt="ai-loadout">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout"><img src="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/ai-loadout"><img src="https://img.shields.io/npm/v/@mcptoolshop/ai-loadout" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-loadout/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

AIエージェント向けのコンテキスト認識型ナレッジルーティングシステム。

`ai-loadout`は、Knowledge OSスタックの中核を担います。ディスパッチテーブル形式、マッチングエンジン、階層型リゾルバー、およびエージェントランタイム契約が含まれます。すべての情報をコンテキストに含める代わりに、小さなインデックスを保持し、必要なときにペイロードをロードします。

ゲームの装備をイメージしてください。各ミッションの前に、エージェントが必要とする知識を正確に装備します。

## インストール

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## 主要な概念

### ディスパッチテーブル

`LoadoutIndex`は、ナレッジペイロードの構造化されたインデックスです。

```json
{
  "version": "1.0.0",
  "generated": "2026-03-06T12:00:00Z",
  "entries": [
    {
      "id": "github-actions",
      "path": ".rules/github-actions.md",
      "keywords": ["ci", "workflow", "runner"],
      "patterns": ["ci_pipeline"],
      "priority": "domain",
      "summary": "CI triggers, path gating, runner cost control",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 680,
      "lines": 56
    }
  ],
  "budget": {
    "always_loaded_est": 320,
    "on_demand_total_est": 8100,
    "avg_task_load_est": 520,
    "avg_task_load_observed": null
  }
}
```

### 優先度レベル

| レベル | 動作 | 例 |
|------|----------|---------|
| `core` | 常にロードされる | "テストをスキップしてCIを成功させることは決してない" |
| `domain` | タスクのキーワードに一致する場合にロードされる | ワークフローの編集時のCIルール |
| `manual` | 自動ロードされない、明示的な参照のみ | プラットフォーム特有の問題 |

### ペイロードのフロントマター

各ペイロードファイルには、独自のルーティングメタデータが含まれています。

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

フロントマターが真実の源です。インデックスはこれに基づいて生成されます。

## エージェントランタイム（主要API）

ランタイムは、エージェントがナレッジペイロードを消費するための標準的な方法です。レイヤーの解決、タスクとのマッチング、ロードするものの決定、使用状況の記録など、一連の処理をまとめて行います。

### `planLoad(task, opts?)`

特定のタスクについて、ロードするものを計画します。これは、エージェントが利用する主要な関数です。

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

以下の情報を含む`LoadPlan`を返します。
- `preload`、`onDemand`、`manual`：ロードモードごとに分類されたエントリ
- `provenance`：各エントリがどのレイヤーから来たか
- `budget`：解決されたインデックスに対するトークン予算
- `preloadTokens`、`onDemandTokens`：トークンコストの合計
- `layerNames`、`conflicts`：レイヤーのメタデータ

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

エージェントがエントリをロードしたことを記録します。これにより、可観測性が向上します（未ロードのエントリ、予算の変動、頻度の追跡）。オプションです。`usagePath`がオプションで設定されている場合にのみ、ログが書き込まれます。

### `manualLookup(id, opts?)`

解決されたインデックスから、IDで指定されたエントリを明示的にロードします。

## リゾルバー

標準的なレイヤースタックからナレッジインデックスを検出し、マージします。

1. **global** — `~/.ai-loadout/index.json`
2. **org** — 明示的なパス、または`$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — 明示的なパス、または`$AI_LOADOUT_SESSION`

後からロードされるレイヤーが優先されます。欠落しているレイヤーは正常です。

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## マッチング

### `matchLoadout(task, index)`

タスクの説明をナレッジインデックスと照合します。マッチの強さに応じてランク付けされたエントリを返します。

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- コアエントリは常に含まれます（スコア1.0）
- マニュアルエントリは自動的に含まれません
- ドメインエントリは、キーワードの重複とパターンのボーナスによってスコアが決定されます
- 結果は、スコアの高い順（降順）、次にトークンコストの低い順（昇順）にソートされます

### `lookupEntry(id, index)`

IDで特定の参照エントリを検索します。マニュアルエントリまたは明示的なアクセスに使用します。

## 可観測性

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

付加専用のJSONL使用状況ログ。ネットワーク接続は使用せず、プライバシーを保護します。

### `findDeadEntries(index, events)`

一度もロードされていないエントリを検索します。

### `findKeywordOverlaps(index)`

エントリ間で共有されているキーワードを検索します（ルーティングの曖昧さ）。

### `analyzeBudget(index, usage?)`

観測された値と推定値の比較による、トークン予算の内訳を表示します。

## マージ

### `mergeIndexes(layers)`

階層構造を持つ設定ファイルの統合機能。`MergedIndex`を返し、データの出所追跡と競合レポート機能を提供します。

## ユーティリティ

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

ペイロードファイルからYAML形式のフロントマターを解析およびシリアライズします。

### `validateIndex(index)`

`LoadoutIndex`の構造的な整合性を検証します。以下の項目を確認します：必須フィールド、一意のID、kebab-case形式、サマリーの範囲、ドメインエントリにおけるキーワードの存在、有効な優先度、非負の予算。

### `estimateTokens(text)`

テキストからトークン数を推定します。文字数を4で割るというヒューリスティックを使用します。

## コマンドラインインターフェース (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

すべてのコマンドは、スクリプト実行のために`--json`オプションをサポートしています。リゾルバーコマンドは、`--project`、`--global`、`--org`、`--session`オプションを受け入れます。

## 型

```typescript
import type {
  LoadoutEntry,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  ValidationIssue,
  Priority,          // "core" | "domain" | "manual"
  Triggers,          // { task, plan, edit }
  LoadMode,          // "eager" | "lazy" | "manual"
  Budget,
  UsageEvent,
  MergeConflict,
  MergedIndex,
  LoadPlan,          // returned by planLoad()
  ResolvedLoadout,   // returned by resolveLoadout()
  EntryExplanation,  // returned by explainEntry()
  IssueSeverity,     // "error" | "warning"
  RuntimeOptions,    // options for planLoad / recordLoad / manualLookup
  ResolveOptions,    // options for resolveLoadout / discoverLayers
  UsageSummary,      // returned by summarizeUsage()
  DeadEntry,         // returned by findDeadEntries()
  KeywordOverlap,    // returned by findKeywordOverlaps()
  BudgetBreakdown,   // returned by analyzeBudget()
  DiscoveredLayer,   // a layer found and loaded by the resolver
  SearchedLayer,     // a layer search location and its result
  EntryDefinition,   // one layer's version of a specific entry
} from "@mcptoolshop/ai-loadout";
```

## コンシューマー

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — Claude Code用のCLAUDE.md最適化ツール。ディスパッチテーブルとマッチングにai-loadoutを使用します。
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — Claude Code用のMEMORY.md最適化ツール。メモリのトピックファイルからディスパッチテーブルを生成します。

## セキュリティ

コアのマッチング、マージ、および検証モジュールは、副作用のない純粋な関数です。使用状況モジュール (`recordUsage` / `readUsage`) は、ローカルファイルシステムI/Oを実行し、追記専用のJSONLログに書き込みます。リゾルバーは、標準のレイヤーパスからインデックスファイルを読み込みます。ネットワークリクエスト、テレメトリー、およびネイティブ依存関係はありません。

### 脅威モデル

| 脅威 | 対策 |
|--------|------------|
| 不正なフロントマター入力 | `parseFrontmatter()`は、無効な入力に対して`null`を返します。例外は発生せず、`eval`は使用しません。 |
| プロトタイプ汚染 | 手動で作成されたパーサーは、プレーンなオブジェクトリテラルを使用しており、信頼できない入力の再帰的なマージは行いません。 |
| 不正なデータを含むインデックス | `validateIndex()`は、構造的な問題を、それが伝播する前に検出します。 |
| 正規表現DoS攻撃 | ユーザーが提供する正規表現はありません。パターンは、プレーンテキストの検索としてマッチします。 |

完全なセキュリティポリシーについては、[SECURITY.md](SECURITY.md) を参照してください。

---

[MCP Tool Shop](https://mcp-tool-shop.github.io/) によって作成されました。
