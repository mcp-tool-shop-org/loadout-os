<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**Un système d’exploitation de connaissances pour les agents de codage IA.** Une seule interface en ligne de commande (CLI) qui transmet le contexte approprié au modèle à la demande, au lieu de charger tous les fichiers de mémoire et toutes les règles dans la fenêtre de contexte au début de chaque session.

Vos fichiers d’instructions et vos bases de données de mémoire se développent sans limite. Chaque ligne coûte des jetons pour chaque requête, qu’elle soit pertinente ou non pour la tâche en cours. loadout-os maintient un petit index de répartition toujours chargé et ne charge les éléments volumineux (sujets de mémoire, fichiers de règles) que lorsque les mots-clés de la tâche correspondent. Considérez cela comme un ensemble d’équipements pour un jeu : équipez l’agent avec exactement les connaissances dont il a besoin pour la mission à venir.

## Ce qu’il y a dedans

loadout-os unifie quatre éléments sous une seule unité binaire `loadout-os` :

| Élément | Ce que cela fait |
|---|---|
| **Kernel** (knowledge router) | Correspondance déterministe de mots-clés/modèles, résolveur hiérarchique à plusieurs niveaux (global → organisation → projet → session) et contrat d’exécution de l’agent. Les éléments principaux se chargent toujours ; les éléments de domaine se chargent en cas de correspondance ; les éléments manuels se chargent lors d’une recherche explicite. |
| **Memories adapter** | Transforme une base de données `MEMORY.md` en une table de répartition lisible par machine et la vérifie (fichiers manquants, orphelins, doublons, entrées trop longues). |
| **Rules adapter** | Divise un fichier `CLAUDE.md` volumineux en un index allégé toujours chargé plus des fichiers de règles chargés à la demande, et valide l’en-tête par rapport à l’index. |
| **Runtime hook** | Un hook `UserPromptSubmit` qui injecte ≤ 5 lignes de pointeur (≤ 200 jetons) dans les entrées pertinentes pour votre requête. En cas d’échec, il ne bloque pas : chaque chemin d’erreur se termine avec le code 0, de sorte qu’un hook défectueux ne peut jamais bloquer une requête. |

Plus trois rituels qui garantissent l’intégrité du système : **`refresh`** (régénérer → valider → publier l’index de répartition, avec un mécanisme de compensation), **`doctor`** (un écran d’état en lecture seule avec 8 vérifications) et **`report`** (observabilité de l’utilisation / des entrées obsolètes / du budget de jetons).

## Interface de commande

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

> **Collision de noms, résolue par l’utilisation d’espaces de noms.** La commande plate `validate <index>` est le validateur de la structure d’index du noyau. Les vérificateurs de la base de données et des règles utilisent des espaces de noms (par exemple, `memories validate <MEMORY.md>` et `rules validate`), de sorte que les trois peuvent coexister. Exécutez `loadout-os <commande> --help` pour obtenir un résumé, des arguments et des codes de sortie par commande.

## Installation

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

Le noyau peut également être importé en tant que bibliothèque : `@mcptoolshop/ai-loadout` expose `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` et les types de table de répartition.

## Documentation

- **[Manuel](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** : présentation, installation, architecture, référence des commandes, rituels et migration à partir des anciens packages.
- **[Dépôt](https://github.com/mcp-tool-shop-org/loadout-os)** : code source, feuille de route et problèmes.

## Pourquoi consolider

La décomposition par secrets (Parnas 1972) était la solution idéale pour une équipe de N personnes. Pour un opérateur solo plus une équipe LLM, elle est opérationnellement inefficace : le travail multi-dépôts fragmente le contexte de l’agent entre les sessions, les adaptateurs non publiés se détériorent (seul le noyau a été publié) et l’avancement se sérialise entre les dépôts. Un seul dépôt unifié avec une seule CLI suffit pour l’opérateur. Le raisonnement complet est contenu dans la base de données de mémoire canonique (`feedback_consolidate_when_cant_juggle_repos.md`).

## État

Publié. **`@mcptoolshop/loadout-os`** est publié sur npm (public) et regroupe le noyau, les deux adaptateurs (mémoires + règles) et le hook d’exécution en direct dans une seule CLI : installez-le avec `npm install -g @mcptoolshop/loadout-os`. Les trois anciens packages qu’il remplace sont mis hors service : le noyau `@mcptoolshop/ai-loadout` est obsolète sur npm (il peut toujours être installé, mais ne recevra plus de mises à jour) ; `claude-memories` et `claude-rules` étaient uniquement locaux et sont archivés. Tous les nouveaux travaux seront effectués ici.

## Modèle de confiance

loadout-os s’exécute entièrement sur votre machine. Il n’y a pas d’appel réseau, pas de télémétrie et pas de compte.

- **Données auxquelles il accède (uniquement localement) :** votre base de données de mémoire (`MEMORY.md` + fichiers de sujets), vos fichiers d’instructions (`CLAUDE.md` + `.claude/rules/`), l’index de répartition généré à côté de la base de données, l’index du résolveur global (`~/.ai-loadout/index.json`) et le journal d’utilisation en annexe uniquement (`~/.ai-loadout/usage.jsonl`).
- **Données auxquelles il n’accède PAS :** pas de transfert de données sur le réseau, pas de télémétrie, pas de services à distance, pas d’informations d’identification ou de secrets. Rien n’est lu, stocké ou transmis en dehors des chemins locaux ci-dessus.
- **Autorisations requises :** uniquement le système de fichiers local. `doctor` et `report` sont en lecture seule (ils n’écrivent jamais). Les seules écritures concernent les fichiers d’index, la sortie interactive de `rules split` et le journal d’utilisation, le tout dans les emplacements locaux attendus ci-dessus. L’écriture irréversible (`refresh` publiant l’index global en direct) est protégée par un arrêt andon en cas d’échec de la validation et un mécanisme de compensation `<dest>.bak`. Le hook d’exécution ne bloque pas : chaque chemin d’erreur se termine avec le code `0`, de sorte qu’il ne peut jamais bloquer une requête.

Modèle de menace complet et processus de signalement : [SECURITY.md](./SECURITY.md).

## Licence

MIT — correspond à toutes les sources en amont.
