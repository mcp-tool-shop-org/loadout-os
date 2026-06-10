<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Routeur de connaissances contextuel pour les agents d'IA.

`ai-loadout` est le cœur de la pile Knowledge OS : tableau de dispatch, moteur de correspondance, résolveur hiérarchique et contrat d'exécution de l'agent. Au lieu de tout charger dans le contexte, vous conservez un index minimal et chargez les données à la demande.

Considérez cela comme une configuration de jeu : vous équipez l'agent exactement des connaissances dont il a besoin avant chaque mission.

## Installation

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Concepts clés

### Le tableau de dispatch

Un `LoadoutIndex` est un index structuré des données de connaissances :

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

### Niveaux de priorité

| Niveau | Comportement | Exemple |
|------|----------|---------|
| `core` | Toujours chargé | "Ne jamais ignorer les tests pour que l'intégration continue soit réussie" |
| `domain` | Chargé lorsque les mots-clés de la tâche correspondent | Règles d'intégration continue lors de la modification des flux de travail |
| `manual` | Jamais chargé automatiquement, recherche explicite uniquement | Détails spécifiques à la plateforme |

### Métadonnées des données

Chaque fichier de données contient ses propres métadonnées de routage :

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

Les métadonnées sont la source de vérité. L'index est dérivé de celles-ci.

## Exécution de l'agent (API principale)

L'exécution est la méthode canonique pour que les agents utilisent une configuration. Elle englobe toute la séquence : résolution des niveaux → correspondance de la tâche → décision de ce qui doit être chargé → enregistrement de l'utilisation.

### `planLoad(task, opts?)`

Planifie ce qui doit être chargé pour une tâche donnée. Il s'agit de la fonction principale destinée à l'agent.

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

Renvoie un `LoadPlan` avec :
- `preload` / `onDemand` / `manual` — entrées séparées par mode de chargement
- `provenance` — de quel niveau chaque entrée provient
- `budget` — budget de jetons pour l'index résolu
- `preloadTokens` / `onDemandTokens` — coûts totaux des jetons
- `layerNames` / `conflicts` — métadonnées du niveau

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

Enregistre qu'un agent a chargé une entrée. Permet l'observabilité (entrées inutilisées, dérive du budget, suivi de la fréquence). Facultatif - n'écrit que si `usagePath` est défini dans les options.

### `manualLookup(id, opts?)`

Charge explicitement une entrée manuelle par ID à partir de l'index résolu.

## Résolveur

Découvre et fusionne les index de configuration à partir d'une pile de niveaux canonique :

1. **global** — `~/.ai-loadout/index.json`
2. **org** — chemin explicite ou `$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — chemin explicite ou `$AI_LOADOUT_SESSION`

Les niveaux ultérieurs ont la priorité. Les niveaux manquants sont normaux.

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## Correspondance

### `matchLoadout(task, index)`

Fait correspondre une description de tâche à un index de configuration. Renvoie les entrées classées par force de correspondance.

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- Les entrées principales sont toujours incluses (score de 1,0)
- Les entrées manuelles ne sont jamais incluses automatiquement
- Les entrées spécifiques au domaine sont notées en fonction du chevauchement des mots-clés + bonus de motif
- Les résultats sont triés par score décroissant, puis par coût des jetons croissant

### `lookupEntry(id, index)`

Recherche une entrée spécifique par ID. Pour les entrées manuelles ou l'accès explicite.

## Observabilité

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

Journal d'utilisation JSONL en append-only. Ne communique jamais avec le réseau, ne collecte jamais de données personnelles.

### `findDeadEntries(index, events)`

Trouve les entrées qui n'ont jamais été chargées.

### `findKeywordOverlaps(index)`

Trouve les mots-clés partagés entre les entrées (ambiguïtés de routage).

### `analyzeBudget(index, usage?)`

Répartition du budget de jetons avec une comparaison entre les valeurs observées et estimées.

## Fusion

### `mergeIndexes(layers)`

Fusion déterministe pour les configurations hiérarchiques. Renvoie un `MergedIndex` avec suivi de l'origine et rapports de conflits.

## Utilitaires

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

Analyse et sérialisation des métadonnées au format YAML à partir des fichiers de charge.

### `validateIndex(index)`

Vérifie l'intégrité structurelle d'un `LoadoutIndex`. Vérifie : champs obligatoires, identifiants uniques, format kebab-case, limites du résumé, présence de mots-clés pour les entrées de domaine, priorités valides, budgets non négatifs.

### `estimateTokens(text)`

Estime le nombre de tokens à partir du texte. Utilise l'heuristique chars/4.

## Interface en ligne de commande (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

Toutes les commandes prennent en charge l'option `--json` pour les scripts. Les commandes de résolution acceptent les options `--project`, `--global`, `--org`, `--session`.

## Types

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

## Consommateurs

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — Optimiseur pour CLAUDE.md pour Claude Code. Utilise ai-loadout pour la table de dispatch et la correspondance.
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — Optimiseur pour MEMORY.md pour Claude Code. Génère des tables de dispatch à partir de fichiers de sujets de mémoire.

## Sécurité

Les modules de correspondance, de fusion et de validation principaux sont des fonctions pures sans effets secondaires. Le module d'utilisation (`recordUsage` / `readUsage`) effectue des opérations d'entrée/sortie sur le système de fichiers local vers un journal JSONL en append-only. Le résolveur lit les fichiers d'index à partir de chemins de couche canoniques. Aucune requête réseau, aucune télémétrie, aucune dépendance native.

### Modèle de menace

| Menace | Atténuation |
|--------|------------|
| Métadonnées d'entrée malformées | `parseFrontmatter()` renvoie `null` en cas d'entrée invalide — aucune exception, pas d'évaluation de code. |
| Pollution de prototype | L'analyseur personnalisé utilise des littéraux d'objets simples, sans fusion récursive de données non fiables. |
| Index contenant des données incorrectes | `validateIndex()` détecte les problèmes structurels avant qu'ils ne se propagent. |
| Attaque DoS par expressions régulières | Aucune expression régulière fournie par l'utilisateur — les motifs sont traités comme des recherches de chaînes simples. |

Consultez [SECURITY.md](SECURITY.md) pour la politique de sécurité complète.

---

Développé par [MCP Tool Shop](https://mcp-tool-shop.github.io/)
