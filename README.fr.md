<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**Un système d’exploitation de connaissances pour les agents de codage IA.** Une seule interface en ligne de commande (CLI) qui transmet le contexte approprié au modèle à la demande, au lieu de charger tous les fichiers de mémoire et toutes les règles dans la fenêtre de contexte au début de chaque session.

Vos fichiers d’instructions et vos référentiels de mémoire se développent sans limite. Chaque ligne coûte des jetons pour chaque requête, qu’elle soit pertinente pour la tâche en cours ou non. loadout-os maintient un petit index de répartition toujours chargé et ne charge les données volumineuses (sujets de mémoire, fichiers de règles) que lorsque les mots-clés de la tâche correspondent. Considérez cela comme un ensemble d’équipements pour un jeu : équipez l’agent avec exactement les connaissances dont il a besoin pour la mission à venir.

## Ce qu’il contient

loadout-os unifie quatre éléments sous un seul exécutable `loadout-os` :

| Élément | Ce qu’il fait |
|---|---|
| **Kernel** (knowledge router) | Correspondance déterministe de mots-clés/motifs, résolveur hiérarchique à plusieurs niveaux (global → organisation → projet → session) et contrat d’exécution de l’agent. Les entrées principales se chargent toujours ; les entrées de domaine se chargent en cas de correspondance ; les entrées manuelles se chargent lors d’une recherche explicite. |
| **Memories adapter** | Transforme un référentiel `MEMORY.md` (plus des sous-index `index-*.md` ou `metadata.loadout_role: subindex` liés) en une table de répartition lisible par machine et effectue une vérification (limites de troncature du chargeur à 180 lignes / 24 Ko — avertissement par défaut, erreur si activée via `--max-lines`/`--max-bytes`, en-tête `metadata.enforce_limits: true` ou `.loadout.json` — plus fichiers manquants, éléments orphelins dans les sous-index, résumés obsolètes, doublons, entrées trop longues). |
| **Rules adapter** | Divise un référentiel `CLAUDE.md` volumineux en un index allégé toujours chargé, ainsi que des fichiers de règles chargés à la demande, et valide l’en-tête par rapport à l’index. |
| **Runtime hooks** | Routeur de pointeurs `UserPromptSubmit` (`loadout-hook.mjs`, fusion des couches globale et de projet avec une limite de partage équitable et une préférence de sous-index), `hook session-start` (injection de UTF-8 + actualisation de l’obsolescence et de l’édition en ligne), `hook pre-compact` (avertissement d’obsolescence avant la compression) et `hook post-write` (validateur `PostToolUse` + actualisation du projet). |

De plus, trois rituels qui garantissent l’intégrité du système : **`refresh`** (régénérer → valider → publier l’index de répartition vers le global ou `--project <root>`, avec un compensateur `.bak`, un verrouillage de fichier du système d’exploitation et une option `--snapshot-repo` / `--mirror-repo`), **`doctor`** (un écran d’intégrité en lecture seule avec 8 vérifications) et **`report`** (observabilité de l’utilisation / des entrées mortes / du budget de jetons).

## Interface de commande

```
# Memory store adapter
loadout-os memories index          <MEMORY.md> [--id-source title|name] [--lazy] [--json]
loadout-os memories validate       <MEMORY.md> [--id-source title|name] [--max-lines <n>] [--max-bytes <n>] [--json]
loadout-os memories stats          <MEMORY.md> [--id-source title|name] [--json]
loadout-os memories health         [path] [--json]
loadout-os memories sync-summaries <MEMORY.md> [--fix] [--json]
loadout-os memories place          <topic.md> <index> [--store <dir>] [--into <index>] [--json]
loadout-os memories move           <topic.md> <index> [--store <dir>] [--into <index>] [--json]

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

# Rituals + hooks
loadout-os doctor [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>] # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]      # drive the runtime hook on a sample prompt
loadout-os hook session-start [--project <r>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <r>]
loadout-os hook post-write    [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix]
loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--id-source title|name] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix] [--dry-run]
```

> **Collision de noms, résolue par l’utilisation d’espaces de noms.** Le référentiel `validate <index>` est le validateur de la structure d’index du noyau. Les vérificateurs de référentiel et de règles utilisent des espaces de noms (`memories validate <MEMORY.md>` et `rules validate`), de sorte que les trois peuvent coexister. Exécutez `loadout-os <command> --help` pour obtenir un synopsis, des arguments et des codes de sortie par commande.

## Mémoire de la couche projet et liaison du hook de code Claude

Chaque instance de projet peut conserver son propre référentiel `.claude/loadout/index.json` construit à partir de son référentiel de mémoire (`loadout-os refresh --store <store> --project <root>`).

### 1. En-tête du sujet et du tableau

```markdown
---
name: Active Board
description: Current active task board and handoff state
priority: core
metadata:
  loadout_inject: session-start
  stale_after_min: 60
  max_lines: 60
  max_bytes: 6000
---
```

- Les sous-index (`index-*.md` ou fichiers avec `metadata.loadout_role: subindex`) sont étendus d’un niveau dans l’index de répartition avec `subindex: true`.
- `index-archive.md` (ou un sous-index avec `metadata.loadout_default_priority: manual`) attribue par défaut ses entrées à `priority: "manual"`, à moins qu’un fichier de sujet ne définisse explicitement `priority:` dans l’en-tête.
- Les entrées `core` avec `metadata.loadout_inject: session-start` sont injectées intégralement à `SessionStart` (et exclues des emplacements de pointeur par requête afin qu’elles ne privent jamais les entrées routées).
- **Source d’ID d’entrée (`idSource: "title" | "name"`) :** Un en-tête explicite `id:` l’emporte toujours. Lorsque `id:` est omis, les référentiels globaux / `--dest` utilisent par défaut `title` (titre de liste à puces en kebab-case dans `MEMORY.md`, préservant les ID d’entrée `v1.0.4`), tandis que les référentiels `--project` utilisent par défaut `name` (en-tête `name:` en kebab-case). Remplacez par référentiel via `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) ou l’en-tête `MEMORY.md` (`metadata.id_source: title | name`), ou par invocation via `--id-source title|name` sur les commandes `refresh` et `memories` (ce qui l’emporte sur le paramètre du référentiel).

### 2. Exemples de blocs de hook `.claude/settings.local.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/loadout-hook/loadout-hook.mjs"
          },
          {
            "type": "command",
            "command": "loadout-os hook session-start --user-prompt-submit"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook pre-compact"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook post-write --fix"
          }
        ]
      }
    ]
  }
}
```

> **Remarque sur les modifications en ligne :** Les modifications apportées aux fichiers de mémoire via une ligne de commande (`Bash` / `PowerShell`) ignorent `PostToolUse` (`Write|Edit`). En tant que solution de repli intégrée, `loadout-os hook session-start` vérifie si un fichier `<store>/*.md` est plus récent que le `index.json` du projet et actualise automatiquement l’index du projet (ou avertit si la validation échoue).

## Installation

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

Le noyau peut également être importé en tant que bibliothèque : `@mcptoolshop/ai-loadout` expose `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` et les types de table de répartition.

## Documentation

- **[Manuel](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — présentation, installation, architecture, référence des commandes, rituels et migration à partir des anciens paquets.
- **[Dépôt](https://github.com/mcp-tool-shop-org/loadout-os)** — code source, feuille de route et problèmes.

## Pourquoi consolider ?

La décomposition par secrets (Parnas 1972) était la solution idéale pour une équipe de N personnes. Pour un opérateur solo et une équipe de LLM, elle est opérationnellement défaillante : le travail multi-référentiel fragmente le contexte de l’agent entre les sessions, les adaptateurs non publiés se détériorent (seul le noyau a été publié) et les progrès se sérialisent entre les référentiels. Un seul référentiel nommé avec une seule CLI est suffisant pour l’opérateur.

## État

Publié. **`@mcptoolshop/loadout-os`** est publié sur npm (public) et regroupe le noyau, les deux adaptateurs (mémoires + règles) et le hook d’exécution en direct dans une seule CLI : installez-le avec `npm install -g @mcptoolshop/loadout-os`. Les trois anciens paquets qu’il remplace sont mis hors service : le noyau `@mcptoolshop/ai-loadout` est déprécié sur npm (il est toujours installable, mais ne recevra plus de mises à jour) ; `claude-memories` et `claude-rules` étaient locaux et sont mis de côté. Tous les nouveaux travaux sont intégrés ici.

## Modèle de confiance

loadout-os s’exécute entièrement sur votre machine. Il n’y a pas d’appel réseau, pas de télémétrie et pas de compte.

- **Données concernées (uniquement locales) :** votre espace de stockage (`MEMORY.md` + fichiers de sujet), vos fichiers d’instructions (`CLAUDE.md` + `.claude/rules/`), l’index de distribution généré à côté de l’espace de stockage, l’index du résolveur global (`~/.ai-loadout/index.json`), l’index du résolveur de projet (`<project>/.claude/loadout/index.json`) et le journal d’utilisation en ajout uniquement (`~/.ai-loadout/usage.jsonl`).
- **Données non concernées :** aucune sortie réseau, aucune télémétrie, aucun service distant, aucun identifiant ou secret. Rien n’est lu, stocké ou transmis en dehors des chemins d’accès locaux mentionnés ci-dessus.
- **Autorisations requises :** uniquement le système de fichiers local. `doctor` et `report` sont des lectures pures (elles n’écrivent jamais). Les seules écritures concernent les fichiers d’index, la sortie interactive `rules split` et le journal d’utilisation, le tout aux emplacements locaux attendus mentionnés ci-dessus. L’écriture irréversible (`refresh`, qui publie l’index global ou de projet en direct) est protégée par un arrêt de type andon en cas d’échec de la validation et un `<dest>.bak` compensateur. Les fonctions d’exécution d’invite et de démarrage de session sont à ouverture par défaut : chaque chemin d’erreur se termine par `0`, de sorte qu’elles ne peuvent jamais bloquer une invite.

Modèle de menace complet et processus de signalement : [SECURITY.md](./SECURITY.md).

## Licence

MIT — correspond à toutes les sources en amont.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
