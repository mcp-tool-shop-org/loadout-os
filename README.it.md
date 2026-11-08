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

**Un sistema operativo per la gestione delle conoscenze per agenti di codifica AI.** Un'unica interfaccia a riga di comando (CLI) che indirizza il contesto corretto al modello su richiesta, invece di caricare tutti i file di memoria e le regole nella finestra di contesto all'inizio di ogni sessione.

I file di istruzioni e gli archivi di memoria crescono in modo illimitato. Ogni riga costa token in ogni richiesta, indipendentemente dal fatto che sia rilevante per l'attività in corso o meno. loadout-os mantiene un piccolo indice di riferimento sempre caricato e carica gli elementi più pesanti (argomenti di memoria, file di regole) solo quando le parole chiave dell'attività corrispondono. Pensalo come un set di equipaggiamento di un gioco: fornisci all'agente esattamente le conoscenze di cui ha bisogno per la missione.

## Cosa contiene

loadout-os unifica quattro componenti in un unico eseguibile `loadout-os`:

| Componente | Cosa fa |
|---|---|
| **Kernel** (knowledge router) | Motore di corrispondenza deterministico di parole chiave/modelli, risolutore gerarchico a più livelli (globale → organizzazione → progetto → sessione) e contratto di runtime dell'agente. Le voci principali vengono sempre caricate; le voci di dominio vengono caricate quando c'è una corrispondenza; le voci manuali vengono caricate quando vengono esplicitamente cercate. |
| **Memories adapter** | Trasforma un archivio `MEMORY.md` (più sotto-indici collegati `index-*.md` o `metadata.loadout_role: subindex`) in una tabella di riferimento leggibile dalla macchina e la verifica (il limite di troncamento del caricatore è di 180 righe / 24 KB; avviso predefinito, errore quando è abilitato tramite `--max-lines`/`--max-bytes`, frontmatter `metadata.enforce_limits: true` o `.loadout.json`; inoltre, verifica la presenza di file mancanti, elementi orfani tra i sotto-indici, riepiloghi obsoleti, duplicati, voci troppo lunghe). |
| **Rules adapter** | Divide un archivio `CLAUDE.md` eccessivamente grande in un indice sempre caricato e più compatto, più file di regole caricati su richiesta, e convalida il frontmatter rispetto all'indice. |
| **Runtime hooks** | Router di puntatori `UserPromptSubmit` (`loadout-hook.mjs`, che unisce i livelli globale e di progetto con un limite di equa distribuzione e una preferenza per i sotto-indici), `hook session-start` (iniezione del board UTF-8 + aggiornamento in caso di obsolescenza e modifica tramite shell), `hook pre-compact` (avviso di obsolescenza prima della compressione) e `hook post-write` (validatore `PostToolUse` + aggiornamento del progetto). |

Inoltre, tre procedure che mantengono l'integrità del sistema: **`refresh`** (rigenera → convalida → pubblica l'indice di riferimento in ambito globale o `--project <root>`, con un compensatore `.bak`, blocco dei file del sistema operativo e opzionale `--snapshot-repo` / `--mirror-repo`), **`doctor`** (una schermata di controllo in sola lettura con 8 verifiche) e **`report`** (osservabilità dell'utilizzo / delle voci obsolete / del budget di token).

## Interfaccia a riga di comando

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

> **Conflitto di nomi, risolto tramite la definizione di spazi dei nomi.** L'archivio `validate <index>` è il validatore della struttura dell'indice del kernel. Gli archivi e i validatori delle regole sono definiti in spazi dei nomi (`memories validate <MEMORY.md>` e `rules validate`), in modo che tutti e tre possano coesistere. Esegui `loadout-os <command> --help` per visualizzare la sintesi, gli argomenti e i codici di uscita per ogni comando.

## Collegamento della memoria a livello di progetto e del codice Claude

Ogni "seat" di progetto può mantenere il proprio archivio `.claude/loadout/index.json`, creato a partire dal suo archivio di memoria (`loadout-os refresh --store <store> --project <root>`).

### 1. Frontmatter per argomento e board

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

- I sotto-indici (`index-*.md` o file con `metadata.loadout_role: subindex`) vengono espansi di un livello nell'indice di riferimento con `subindex: true`.
- `index-archive.md` (o un sotto-indice con `metadata.loadout_default_priority: manual`) imposta le voci su `priority: "manual"` per impostazione predefinita, a meno che un file di argomento non imposti esplicitamente `priority:` nel frontmatter.
- Le voci `core` con `metadata.loadout_inject: session-start` vengono inserite completamente in `SessionStart` (e vengono escluse dagli slot di puntatore per ogni richiesta, in modo che non "affamino" le voci indirizzate).
- **Origine dell'ID di voce (`idSource: "title" | "name"`):** Un frontmatter esplicito `id:` ha sempre la precedenza. Quando `id:` viene omesso, gli archivi globali / `--dest` utilizzano `title` per impostazione predefinita (titolo dell'elenco con trattini in `MEMORY.md`, preservando gli ID di voce `v1.0.4`), mentre gli archivi `--project` utilizzano `name` per impostazione predefinita (frontmatter con trattini `name:`). È possibile sovrascrivere per archivio tramite `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) o il frontmatter `MEMORY.md` (`metadata.id_source: title | name`), oppure per invocazione tramite `--id-source title|name` nei comandi `refresh` e `memories` (che ha la precedenza sull'impostazione dell'archivio).

### 2. Esempi di blocchi di collegamento `.claude/settings.local.json`

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

> **Nota sulle modifiche tramite shell:** Le modifiche apportate ai file di memoria tramite una shell (`Bash` / `PowerShell`) ignorano `PostToolUse` (`Write|Edit`). Come fallback integrato, `loadout-os hook session-start` verifica se esiste un file `<store>/*.md` più recente del progetto `index.json` e aggiorna automaticamente l'indice del progetto (o avvisa se la convalida fallisce).

## Installazione

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

Il kernel può anche essere importato come libreria: `@mcptoolshop/ai-loadout` espone `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` e i tipi di tabella di riferimento.

## Documentazione

- **[Manuale](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**: panoramica, installazione, architettura, riferimento ai comandi, procedure e migrazione dai pacchetti legacy.
- **[Repository](https://github.com/mcp-tool-shop-org/loadout-os)**: codice sorgente, roadmap e problemi.

## Perché consolidare

La decomposizione per segreti (Parnas 1972) era la soluzione ideale per un team di N persone. Per un operatore singolo e un gruppo di LLM, è inefficiente: il lavoro multi-repository frammenta il contesto dell'agente tra le sessioni, gli adattatori non pubblicati si deteriorano (solo il kernel è stato effettivamente rilasciato) e il progresso avviene in modo sequenziale tra i repository. Un unico repository con nome e un'unica CLI servono l'operatore.

## Stato

Rilasciato. **`@mcptoolshop/loadout-os`** è pubblicato su npm (pubblico) e include il kernel, i due adattatori (memorie + regole) e il collegamento di runtime attivo in un'unica CLI: installalo con `npm install -g @mcptoolshop/loadout-os`. I tre pacchetti legacy che sostituisce sono stati dismessi: il kernel `@mcptoolshop/ai-loadout` è deprecato su npm (ancora installabile, ma non riceverà ulteriori aggiornamenti); `claude-memories` e `claude-rules` erano solo locali e sono stati archiviati. Tutti i nuovi sviluppi avverranno qui.

## Modello di fiducia

loadout-os viene eseguito interamente sulla tua macchina. Non ci sono chiamate di rete, né telemetria, né account.

- **Dati a cui accede (solo a livello locale):** la memoria (`MEMORY.md` + file relativi all'argomento), i file di istruzione (`CLAUDE.md` + `.claude/rules/`), l'indice di distribuzione generato accanto alla memoria, l'indice del resolver globale (`~/.ai-loadout/index.json`), l'indice del resolver del progetto (`<project>/.claude/loadout/index.json`) e il registro di utilizzo in modalità di sola aggiunta (`~/.ai-loadout/usage.jsonl`).
- **Dati a cui NON accede:** nessuna comunicazione di rete, nessun dato di telemetria, nessun servizio remoto, nessuna credenziale o segreto. Nessun dato viene letto, memorizzato o trasmesso al di fuori dei percorsi locali indicati sopra.
- **Autorizzazioni richieste:** solo il filesystem locale. `doctor` e `report` sono accessi in sola lettura (non effettuano mai scritture). Le uniche scritture riguardano i file di indice, l'output interattivo `rules split` e il registro di utilizzo, il tutto nelle posizioni locali previste. La scrittura irreversibile (`refresh`, che pubblica l'indice globale o dell'ambito del progetto) è protetta da un meccanismo di interruzione in caso di fallimento della validazione e da un `<dest>.bak` compensatore. Gli hook di runtime per l'avvio della sessione e la richiesta sono configurati per consentire il funzionamento anche in caso di errore: ogni percorso di errore esce da `0`, quindi non possono mai bloccare una richiesta.

Modello completo delle minacce e processo di segnalazione: [SECURITY.md](./SECURITY.md).

## Licenza

MIT: corrisponde a tutte le fonti originali.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
