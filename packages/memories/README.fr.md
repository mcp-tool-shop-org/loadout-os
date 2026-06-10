<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Optimiseur et générateur de table de dispatch pour les fichiers MEMORY.md, destinés à Claude Code.

Mettez votre fichier MEMORY.md au régime. claude-memories analyse vos fichiers de mémoire, génère une table de dispatch lisible par machine et vous montre comment votre budget de contexte est utilisé.

## Le problème

La mémoire automatique de Claude Code se transforme en un fichier MEMORY.md volumineux qui consomme la fenêtre de contexte. Chaque session charge plus de 40 000 jetons de mémoire, dont la plupart ne sont pas pertinents pour la tâche en cours.

## La solution

claude-memories indexe vos fichiers de mémoire dans une table de dispatch. Un agent peut accéder au sujet de mémoire approprié à la demande, au lieu de charger tout.

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**Économies de 98 %** sur un espace de travail de mémoire avec 31 sujets.

## Installation

```bash
npm install -g @mcptoolshop/claude-memories
```

## Commandes

### analyze

Analyse la structure, les références et les coûts en jetons du fichier MEMORY.md.

```bash
claude-memories analyze MEMORY.md
```

### index

Génère une table de dispatch (index.json) à partir de vos fichiers de mémoire.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

Vérifie les fichiers de mémoire pour détecter les problèmes de structure.

```bash
claude-memories validate MEMORY.md
```

Vérifie : fichiers de sujets manquants, fichiers orphelins, références en double, noms vides.

### stats

Tableau de bord du budget de jetons.

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

## Fonctionnement

1. Analyse le fichier MEMORY.md pour les références aux sujets (format flèche : `Nom → chemin`)
2. Lit chaque fichier de sujet, extrait les mots-clés des titres et du contenu.
3. Génère un LoadoutIndex (table de dispatch) compatible avec ai-loadout.
4. Vérifie l'intégrité structurelle (fichiers manquants, orphelins, doublons).

### Format de référence

Les entrées du fichier MEMORY.md suivent ce format :

```
Topic Name — description → `memory/topic-file.md`
```

Les formats à puces et sans puces sont pris en charge :

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### Préambule (facultatif)

Les fichiers de sujets peuvent inclure un préambule pour un contrôle plus précis :

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

Sans préambule, les mots-clés sont extraits automatiquement du nom du sujet et des titres.

## Architecture

claude-memories est un **adaptateur de niveau 2** dans la pile Knowledge OS :

| Niveau | Package | Rôle |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Types de routage, correspondance, validation |
| Adaptateur | `@mcptoolshop/claude-rules` | Optimisation CLAUDE.md |
| Adaptateur | `@mcptoolshop/claude-memories` | Optimisation MEMORY.md |

Même noyau, différents types de documents. Les deux produisent des tables de dispatch compatibles.

## Sécurité

- **Locale uniquement** : Pas d'appels réseau, pas de télémétrie.
- **Lecture principalement** : Écrit uniquement le fichier index.json ; ne modifie jamais le fichier MEMORY.md.
- **Déterministe** : Les mêmes entrées → les mêmes sorties.

Consultez [SECURITY.md](SECURITY.md) pour le modèle de menace.

## Licence

MIT

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
