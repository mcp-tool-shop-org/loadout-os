<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Mettez votre fichier CLAUDE.md au régime.

`claude-rules` est un générateur de table de répartition et un optimiseur de fichiers d'instructions pour [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Il divise les fichiers d'instructions volumineux en un index de routage minuscule (toujours chargé) et en fichiers de règles spécifiques à un sujet (chargés à la demande), ce qui permet d'économiser des jetons de contexte à chaque session.

## Le problème

Les fichiers CLAUDE.md grossissent avec le temps. Chaque ligne coûte des jetons à chaque session, que ce soit pertinent ou non. Un fichier d'instructions de 300 lignes devient une charge pour chaque pensée du modèle.

## La solution

Trois niveaux, sans ambiguïté :

| Niveau | Fichier | Chargé |
|-------|------|--------|
| Console de l'opérateur | `CLAUDE.md` | Toujours (index léger) |
| Table de répartition | `.claude/rules/index.json` | Toujours (lisible par machine) |
| Contenu des règles | `.claude/rules/*.md` | À la demande |

Chaque fichier de règles contient ses propres métadonnées de routage en tant que préambule :

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

Lorsque l'agent voit une tâche qui mentionne "CI" ou "workflow", il lit le fichier de règles correspondant. Le reste reste déchargé.

## Installation

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## Utilisation

### Analyse

Évaluez les sections de votre fichier CLAUDE.md et voyez ce qui peut être extrait :

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

### Division

Extraction interactive : vous approuvez chaque section avant qu'elle ne soit extraite :

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

Chaque extraction proposée affiche un aperçu, un nom de fichier suggéré, des mots-clés et une priorité. Vous approuvez ou ignorez chacun d'eux.

### Validation

Vérifiez votre répertoire de règles pour détecter les problèmes de santé :

```bash
claude-rules validate
```

Vérifications pour : références de fichiers manquantes, fichiers de règles orphelins, dérive du préambule, mots-clés vides dans les règles de domaine, identifiants en double.

### Statistiques

Visualisez le fonctionnement de votre système :

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

## Niveaux de priorité

| Niveau | Comportement | Exemple |
|------|----------|---------|
| `core` | Toujours intégré dans CLAUDE.md | "Le test est correct jusqu'à preuve du contraire" |
| `domain` | Chargé lorsque les mots-clés de la tâche correspondent | Règles GitHub Actions lors de la modification de CI |
| `manual` | Jamais chargé automatiquement, recherche délibérée | Particularités obscures de la plateforme |

## Fonctionnement du routage

L'agent voit la table de répartition dans CLAUDE.md et deux signaux l'incitent à charger un fichier de règles :

1. **Correspondance sémantique** : la tâche mentionne "publication" ou "CI".
2. **Instruction explicite** : CLAUDE.md indique "lire ce fichier de règles avant de planifier ou de modifier".

Il s'agit d'un système d'indices pour la boucle de l'agent, et non de magie. La combinaison de la correspondance de mots-clés et de l'instruction explicite le rend fiable.

## Invariants

- Chaque section extraite laisse un résumé d'une seule ligne dans CLAUDE.md.
- Chaque règle `domain`/`manual` existe dans `index.json`.
- Chaque règle `core` reste intégrée (jamais extraite uniquement dans un fichier).
- Le préambule est la source de vérité ; `index.json` est dérivé.
- L'analyseur ne divise que sur les titres ATX (`##`, `###`).

## Sécurité

Cet outil lit et écrit uniquement des fichiers Markdown et JSON locaux. Il ne fait aucune requête réseau, ne collecte aucune télémétrie et n'accède à aucun service externe.

### Modèle de menace

| Menace | Atténuation |
|--------|------------|
| Perte de données due à une mauvaise division | Approbation interactive + mode `--dry-run` |
| Fichiers de règles malformés | La commande `validate` détecte tous les problèmes structurels. |
| Index obsolète | `validate` détecte les écarts entre le préambule et `index.json`. |

Consultez [SECURITY.md](SECURITY.md) pour connaître la politique de sécurité complète.

---

Créé par [MCP Tool Shop](https://mcp-tool-shop.github.io/)
