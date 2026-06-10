<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Router di conoscenza contestuale per agenti AI.

`ai-loadout` è il cuore dello stack Knowledge OS: include una tabella di dispatch, un motore di matching, un risolutore gerarchico e un contratto di runtime per gli agenti. Invece di inserire tutto nel contesto, si mantiene un indice ridotto e si caricano i dati solo quando necessario.

Immaginate che sia una configurazione di gioco: si fornisce all'agente esattamente le conoscenze di cui ha bisogno prima di ogni missione.

## Installazione

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Concetti fondamentali

### La tabella di dispatch

Un `LoadoutIndex` è un indice strutturato di payload di conoscenza:

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

### Livelli di priorità

| Livello | Comportamento | Esempio |
|------|----------|---------|
| `core` | Caricato sempre | "non saltare mai i test per mantenere il CI verde" |
| `domain` | Caricato quando le parole chiave del task corrispondono | Regole del CI durante la modifica dei workflow |
| `manual` | Non caricato automaticamente, solo ricerca esplicita | Aspetti oscuri della piattaforma |

### Metadati del payload

Ogni file payload contiene i propri metadati di routing:

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

I metadati sono la fonte di verità. L'indice viene derivato da essi.

## Runtime dell'agente (API principale)

Il runtime è il modo canonico in cui gli agenti utilizzano una configurazione. Gestisce l'intera sequenza: risoluzione dei livelli → matching del task → decisione di cosa caricare → registrazione dell'utilizzo.

### `planLoad(task, opts?)`

Pianifica cosa caricare per un determinato task. Questa è la funzione principale rivolta all'agente.

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

Restituisce un `LoadPlan` con:
- `preload` / `onDemand` / `manual` — voci separate per modalità di caricamento
- `provenance` — da quale livello proviene ogni voce
- `budget` — budget di token per l'indice risolto
- `preloadTokens` / `onDemandTokens` — costi totali dei token
- `layerNames` / `conflicts` — metadati del livello

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

Registra che un agente ha caricato una voce. Permette di monitorare (voci non utilizzate, deriva del budget, frequenza). Opzionale: scrive solo se `usagePath` è impostato nelle opzioni.

### `manualLookup(id, opts?)`

Carica esplicitamente una voce manuale tramite ID dall'indice risolto.

## Risolutore

Scopri e unisci gli indici di configurazione da uno stack di livelli canonico:

1. **global** — `~/.ai-loadout/index.json`
2. **org** — percorso esplicito o `$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — percorso esplicito o `$AI_LOADOUT_SESSION`

I livelli successivi hanno la precedenza. I livelli mancanti sono normali.

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## Matching

### `matchLoadout(task, index)`

Confronta una descrizione del task con un indice di configurazione. Restituisce voci ordinate in base alla forza del matching.

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- Le voci principali sono sempre incluse (punteggio 1.0)
- Le voci manuali non sono mai incluse automaticamente
- Le voci specifiche del dominio sono valutate in base alla sovrapposizione delle parole chiave + bonus per i pattern
- I risultati sono ordinati per punteggio decrescente, quindi per costo dei token crescente

### `lookupEntry(id, index)`

Cerca una voce specifica tramite ID. Per voci manuali o accesso esplicito.

## Monitoraggio

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

Registro di utilizzo in formato JSONL (solo aggiunte). Non è mai connesso alla rete, non raccoglie dati sensibili.

### `findDeadEntries(index, events)`

Trova le voci che non sono mai state caricate.

### `findKeywordOverlaps(index)`

Trova le parole chiave condivise tra le voci (ambiguità di routing).

### `analyzeBudget(index, usage?)`

Analisi del budget dei token con confronto tra valori osservati e stimati.

## Unione

### `mergeIndexes(layers)`

Unione deterministica per configurazioni gerarchiche. Restituisce un `MergedIndex` con tracciamento della provenienza e segnalazione dei conflitti.

## Utilità

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

Analizza e serializza il frontmatter in formato YAML dai file di payload.

### `validateIndex(index)`

Verifica l'integrità strutturale di un `LoadoutIndex`. Controlla: campi obbligatori, ID univoci, formato kebab-case, limiti del riepilogo, presenza di parole chiave per le voci di dominio, priorità valide, budget non negativi.

### `estimateTokens(text)`

Stima il numero di token da un testo. Utilizza l'euristica chars/4.

## Interfaccia a riga di comando (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

Tutti i comandi supportano `--json` per l'utilizzo in script. I comandi di risoluzione accettano `--project`, `--global`, `--org`, `--session`.

## Tipi

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

## Consumatori

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — Ottimizzatore per CLAUDE.md per Claude Code. Utilizza ai-loadout per la tabella di dispatch e la corrispondenza.
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — Ottimizzatore per MEMORY.md per Claude Code. Genera tabelle di dispatch dai file degli argomenti di memoria.

## Sicurezza

I moduli principali di corrispondenza, unione e validazione sono funzioni pure senza effetti collaterali. Il modulo di utilizzo (`recordUsage` / `readUsage`) esegue operazioni di I/O sul filesystem locale verso un log JSONL di sola scrittura. Il resolver legge i file di indice da percorsi di livello standard. Nessuna richiesta di rete, nessuna telemetria, nessuna dipendenza native.

### Modello di minaccia

| Minaccia | Mitigazione |
|--------|------------|
| Input del frontmatter malformato | `parseFrontmatter()` restituisce `null` in caso di input non valido — nessuna eccezione, nessuna valutazione di codice. |
| Iniezione di prototipi | L'analizzatore personalizzato utilizza letterali di oggetti semplici, senza unione ricorsiva di input non attendibili. |
| Indice con dati errati | `validateIndex()` rileva i problemi strutturali prima che si propaghino. |
| Attacco DoS tramite espressioni regolari | Nessuna espressione regolare fornita dall'utente — i pattern vengono confrontati come ricerche di stringhe semplici. |

Consultare [SECURITY.md](SECURITY.md) per la politica di sicurezza completa.

---

Creato da [MCP Tool Shop](https://mcp-tool-shop.github.io/)
