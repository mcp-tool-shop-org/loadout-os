<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**Un sistema operativo per la gestione delle conoscenze per agenti di codifica AI.** Un'unica interfaccia a riga di comando (CLI) che indirizza il contesto corretto al modello su richiesta, anziché caricare tutti i file di memoria e le regole nella finestra di contesto all'inizio di ogni sessione.

I file di istruzioni e gli archivi di memoria crescono in modo illimitato. Ogni riga costa token per ogni richiesta, indipendentemente dal fatto che sia rilevante per l'attività in corso o meno. loadout-os mantiene un piccolo indice di riferimento sempre caricato e carica gli elementi più pesanti (argomenti di memoria, file di regole) solo quando le parole chiave dell'attività corrispondono. Pensalo come un set di equipaggiamento di un gioco: fornisci all'agente esattamente le conoscenze di cui ha bisogno per la missione.

## Cosa contiene

loadout-os unifica quattro componenti in un unico eseguibile `loadout-os`:

| Componente | Cosa fa |
|---|---|
| **Kernel** (knowledge router) | Motore di corrispondenza deterministico di parole chiave/modelli, risolutore gerarchico a più livelli (globale → organizzazione → progetto → sessione) e contratto di runtime dell'agente. Le voci principali vengono sempre caricate; le voci di dominio vengono caricate quando c'è una corrispondenza; le voci manuali vengono caricate quando viene effettuata una ricerca esplicita. |
| **Memories adapter** | Trasforma un archivio `MEMORY.md` in una tabella di riferimento leggibile dalla macchina e ne esegue il controllo (file mancanti, elementi orfani, duplicati, voci troppo lunghe). Legge entrambi gli stili di indice: i link `- [Title](file.md) — hook` di Claude Code e i riferimenti `Name — description → path` in formato arrow. |
| **Rules adapter** | Divide un archivio `CLAUDE.md` eccessivamente grande in un indice sempre caricato e più leggero, più file di regole caricati su richiesta, e convalida l'intestazione rispetto all'indice. |
| **Runtime hook** | Un hook `UserPromptSubmit` che inserisce ≤5 righe di puntatore (≤200 token) nelle voci rilevanti per la tua richiesta. In caso di errore, non si blocca: ogni percorso di errore termina con codice 0, quindi un hook difettoso non può mai bloccare una richiesta. |

Inoltre, tre procedure che mantengono l'integrità del sistema: **`refresh`** (rigenera → convalida → pubblica l'indice di riferimento, con un meccanismo di compensazione di backup), **`doctor`** (una schermata di controllo in sola lettura con 8 verifiche) e **`report`** (monitoraggio dell'utilizzo, delle voci obsolete e del budget di token).

## Interfaccia di comando

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

> **Conflitto di nomi, risolto tramite la definizione di spazi dei nomi.** L'archivio piatto `validate <index>` è il validatore della struttura dell'indice del kernel. Gli strumenti di controllo dell'archivio e delle regole sono definiti in spazi dei nomi diversi (`memories validate <MEMORY.md>` e `rules validate`), in modo che tutti e tre possano coesistere. Esegui `loadout-os <command> --help` per visualizzare la sintassi, gli argomenti e i codici di uscita per ogni comando.

## Installazione

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

Il kernel può anche essere importato come libreria: `@mcptoolshop/ai-loadout` espone `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` e i tipi di tabella di riferimento.

## Documentazione

- **[Manuale](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — panoramica, installazione, architettura, riferimento ai comandi, procedure e migrazione dai pacchetti legacy.
- **[Repository](https://github.com/mcp-tool-shop-org/loadout-os)** — codice sorgente, roadmap e problemi.

## Perché consolidare

La decomposizione per segreti (Parnas 1972) era la soluzione ideale per un team di N persone. Per un operatore singolo e un gruppo di LLM, è inefficiente: il lavoro multi-repository frammenta il contesto dell'agente tra le sessioni, gli adattatori non pubblicati si deteriorano (solo il kernel viene effettivamente rilasciato) e il progresso avviene in modo seriale tra i repository. Un unico repository con un unico nome e un'unica CLI semplifica il lavoro dell'operatore.

## Stato

Rilasciato. **`@mcptoolshop/loadout-os`** è pubblicato su npm (pubblico) e include il kernel, i due adattatori (memorie + regole) e l'hook di runtime attivo in un'unica CLI: installalo con `npm install -g @mcptoolshop/loadout-os`. I tre pacchetti legacy che sostituisce sono stati dismessi: il kernel `@mcptoolshop/ai-loadout` è deprecato su npm (ancora installabile, ma non riceverà ulteriori aggiornamenti); `claude-memories` e `claude-rules` erano solo locali e sono stati archiviati. Tutti i nuovi sviluppi avverranno qui.

## Modello di fiducia

loadout-os viene eseguito interamente sulla tua macchina. Non ci sono chiamate di rete, telemetria o account.

- **Dati a cui accede (solo locali):** il tuo archivio di memoria (`MEMORY.md` + file di argomento), i tuoi file di istruzioni (`CLAUDE.md` + `.claude/rules/`), l'indice di riferimento generato accanto all'archivio, l'indice del risolutore globale (`~/.ai-loadout/index.json`) e il registro dell'utilizzo in sola aggiunta (`~/.ai-loadout/usage.jsonl`).
- **Dati a cui NON accede:** nessuna comunicazione di rete, nessuna telemetria, nessun servizio remoto, nessuna credenziale o segreto. Nulla viene letto, archiviato o trasmesso al di fuori dei percorsi locali sopra indicati.
- **Autorizzazioni richieste:** solo il filesystem locale. `doctor` e `report` sono letture pure (non scrivono mai). Le uniche scritture sono i file di indice, l'output interattivo `rules split` e il registro dell'utilizzo, tutti nelle posizioni locali previste sopra. La scrittura irreversibile (`refresh`, pubblicazione dell'indice globale attivo) è protetta da un meccanismo di interruzione in caso di fallimento della convalida e da un compensatore `<dest>.bak`. L'hook di runtime è progettato per non bloccarsi: ogni percorso di errore termina con codice `0`, quindi non può mai bloccare una richiesta.

Modello completo delle minacce e processo di segnalazione: [SECURITY.md](./SECURITY.md).

## Licenza

MIT — corrisponde a tutte le fonti upstream.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
