<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Ottimizzatore e generatore di tabelle di dispatch per i file MEMORY.md, specifici per Claude Code.

Mettete a dieta i vostri file MEMORY.md. claude-memories analizza i vostri file di memoria, genera una tabella di dispatch leggibile dalle macchine e vi mostra come viene utilizzato il vostro budget di contesto.

## Il problema

La memoria automatica di Claude Code si trasforma in un enorme file MEMORY.md che consuma spazio nella finestra di contesto. Ogni sessione carica più di 40.000 token di informazioni, la maggior parte delle quali irrilevanti per l'attività corrente.

## La soluzione

claude-memories indicizza i vostri file di memoria in una tabella di dispatch. Un agente può accedere all'argomento di memoria corretto su richiesta, invece di caricare tutto.

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**Risparmio del 98%** in un ambiente di lavoro con 31 argomenti.

## Installazione

```bash
npm install -g @mcptoolshop/claude-memories
```

## Comandi

### analyze

Analizza la struttura, i riferimenti e i costi in token del file MEMORY.md.

```bash
claude-memories analyze MEMORY.md
```

### index

Genera una tabella di dispatch (index.json) dai vostri file di memoria.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

Verifica i file di memoria per individuare problemi strutturali.

```bash
claude-memories validate MEMORY.md
```

Controlla la presenza di: file di argomento mancanti, file orfani, riferimenti duplicati, nomi vuoti.

### stats

Dashboard del budget di token.

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

## Come funziona

1. Analizza il file MEMORY.md per i riferimenti agli argomenti (formato freccia: `Nome → percorso`)
2. Legge ogni file di argomento, estrae le parole chiave dai titoli e dal contenuto.
3. Genera un LoadoutIndex (tabella di dispatch) compatibile con ai-loadout.
4. Verifica l'integrità strutturale (file mancanti, orfani, duplicati).

### Formato di riferimento

Le voci del file MEMORY.md seguono questo formato:

```
Topic Name — description → `memory/topic-file.md`
```

Sono supportati sia formati con elenchi puntati che senza.

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### Frontmatter (Opzionale)

I file di argomento possono includere un frontmatter per un controllo più preciso:

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

In assenza di frontmatter, le parole chiave vengono estratte automaticamente dal nome dell'argomento e dai titoli.

## Architettura

claude-memories è un **adattatore di livello 2** nello stack Knowledge OS:

| Livello | Pacchetto | Ruolo |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Tipi di routing, corrispondenza, validazione |
| Adattatore | `@mcptoolshop/claude-rules` | Ottimizzazione di CLAUDE.md |
| Adattatore | `@mcptoolshop/claude-memories` | Ottimizzazione di MEMORY.md |

Stesso kernel, tipi di documento diversi. Entrambi producono tabelle di dispatch compatibili.

## Sicurezza

- **Solo locale**: Nessuna chiamata di rete, nessuna telemetria.
- **Principalmente in lettura**: Scrive solo il file index.json; non modifica mai il file MEMORY.md.
- **Deterministica**: Stessi input → stessi output.

Consultare [SECURITY.md](SECURITY.md) per il modello di minaccia.

## Licenza

MIT

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
