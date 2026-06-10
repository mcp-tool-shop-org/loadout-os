<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Roteador de conhecimento contextualmente adaptável para agentes de IA.

`ai-loadout` é o núcleo da pilha Knowledge OS — formato de tabela de despacho, mecanismo de correspondência, resolvedor hierárquico e contrato de tempo de execução do agente. Em vez de colocar tudo no contexto, você mantém um índice pequeno e carrega os dados sob demanda.

Pense nisso como um "loadout" de jogo — você equipa o agente com exatamente o conhecimento que ele precisa antes de cada missão.

## Instalação

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Conceitos Fundamentais

### A Tabela de Despacho

Um `LoadoutIndex` é um índice estruturado de dados de conhecimento:

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

### Níveis de Prioridade

| Nível | Comportamento | Exemplo |
|------|----------|---------|
| `core` | Carregado sempre | "nunca pule testes para manter o CI verde" |
| `domain` | Carregado quando as palavras-chave da tarefa correspondem | Regras de CI ao editar fluxos de trabalho |
| `manual` | Nunca carregado automaticamente, apenas pesquisa explícita | Detalhes obscuros da plataforma |

### Metadados do Dado

Cada arquivo de dado contém seus próprios metadados de roteamento:

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

O metadado é a fonte da verdade. O índice é derivado dele.

## Tempo de Execução do Agente (API Primária)

O tempo de execução é a maneira canônica de os agentes consumirem um "loadout". Ele envolve toda a sequência: resolver camadas → corresponder à tarefa → decidir o que carregar → registrar o uso.

### `planLoad(tarefa, opções?)`

Planeja o que carregar para uma determinada tarefa. Esta é a função principal voltada para o agente.

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

Retorna um `LoadPlan` com:
- `preload` / `onDemand` / `manual` — entradas separadas pelo modo de carregamento
- `provenance` — de qual camada cada entrada veio
- `budget` — orçamento de tokens para o índice resolvido
- `preloadTokens` / `onDemandTokens` — custos totais de tokens
- `layerNames` / `conflicts` — metadados da camada

### `recordLoad(idEntrada, gatilho, modo, tokensEstimados, opções?)`

Registra que um agente carregou uma entrada. Permite a observabilidade (entradas não utilizadas, desvio de orçamento, rastreamento de frequência). Opcional — grava apenas quando `usagePath` é definido nas opções.

### `manualLookup(id, opções?)`

Carrega explicitamente uma entrada manual por ID do índice resolvido.

## Resolvedor

Descobre e mescla índices de "loadout" de uma pilha de camadas canônica:

1. **global** — `~/.ai-loadout/index.json`
2. **org** — caminho explícito ou `$AI_LOADOUT_ORG`
3. **projeto** — `<cwd>/.claude/loadout/index.json`
4. **sessão** — caminho explícito ou `$AI_LOADOUT_SESSION`

As camadas posteriores têm precedência. Camadas ausentes são normais.

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## Correspondência

### `matchLoadout(tarefa, índice)`

Corresponde uma descrição de tarefa a um índice de "loadout". Retorna entradas classificadas pela força da correspondência.

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- Entradas principais sempre incluídas (pontuação 1.0)
- Entradas manuais nunca incluídas automaticamente
- Entradas de domínio pontuadas por sobreposição de palavras-chave + bônus de padrão
- Resultados classificados por pontuação decrescente, depois por custo de token crescente

### `lookupEntry(id, índice)`

Pesquisa uma entrada específica por ID. Para entradas manuais ou acesso explícito.

## Observabilidade

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

Registro de uso JSONL somente para anexação. Nunca conectado à rede, nunca invasivo.

### `findDeadEntries(índice, eventos)`

Encontra entradas que nunca foram carregadas.

### `findKeywordOverlaps(índice)`

Encontra palavras-chave compartilhadas entre entradas (ambiguidades de roteamento).

### `analyzeBudget(índice, uso?)`

Detalhes do orçamento de tokens com comparação entre o observado e o estimado.

## Mesclar

### `mergeIndexes(camadas)`

Mesclagem determinística para configurações hierárquicas. Retorna um `MergedIndex` com rastreamento de origem e relatórios de conflitos.

## Utilitários

### `parseFrontmatter(conteúdo)` / `serializeFrontmatter(fm)`

Analisa e serializa metadados no formato YAML de arquivos de carga.

### `validateIndex(índice)`

Valida a integridade estrutural de um `LoadoutIndex`. Verifica: campos obrigatórios, IDs únicos, formato kebab-case, limites do resumo, presença de palavras-chave para entradas de domínio, prioridades válidas, orçamentos não negativos.

### `estimateTokens(texto)`

Estima a contagem de tokens a partir do texto. Utiliza a heurística de chars/4.

## Interface de Linha de Comando (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

Todos os comandos suportam `--json` para scripts. Os comandos de resolução aceitam `--project`, `--global`, `--org`, `--session`.

## Tipos

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

## Consumidores

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — Otimizador para CLAUDE.md para Claude Code. Utiliza ai-loadout para a tabela de despacho e correspondência.
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — Otimizador para MEMORY.md para Claude Code. Gera tabelas de despacho a partir de arquivos de tópicos de memória.

## Segurança

Os módulos principais de correspondência, mesclagem e validação são funções puras sem efeitos colaterais. O módulo de uso (`recordUsage` / `readUsage`) realiza operações de entrada/saída no sistema de arquivos local para um arquivo JSONL somente para anexar. O resolvedor lê arquivos de índice de caminhos de camada canônicos. Não há solicitações de rede, telemetria ou dependências nativas.

### Modelo de Ameaças

| Ameaça | Mitigação |
|--------|------------|
| Entrada de metadados malformada | `parseFrontmatter()` retorna `null` em caso de entrada inválida — sem exceções, sem `eval`. |
| Poluição de protótipos | O analisador personalizado usa literais de objeto simples, sem mesclagem recursiva de entradas não confiáveis. |
| Índice com dados incorretos | `validateIndex()` detecta problemas estruturais antes que eles se propaguem. |
| Ataque DoS com expressões regulares | Nenhuma expressão regular fornecida pelo usuário — os padrões são correspondidos como pesquisas de string simples. |

Consulte [SECURITY.md](SECURITY.md) para a política de segurança completa.

---

Desenvolvido por [MCP Tool Shop](https://mcp-tool-shop.github.io/)
