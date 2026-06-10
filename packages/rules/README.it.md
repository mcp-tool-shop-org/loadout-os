<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Metti il tuo file CLAUDE.md a dieta.

`claude-rules` è un generatore di tabelle di dispatch e un ottimizzatore di file di istruzioni per [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Divide i file di istruzioni troppo grandi in un indice di routing molto piccolo (sempre caricato) e in file di regole specifici per argomento (caricati su richiesta), risparmiando token di contesto ad ogni sessione.

## Il problema

I file CLAUDE.md crescono nel tempo. Ogni riga costa token ad ogni sessione, indipendentemente dal fatto che sia rilevante o meno. Un file di istruzioni di 300 righe diventa una tassa su ogni pensiero del modello.

## La soluzione

Tre livelli, senza ambiguità:

| Livello | File | Caricato |
|-------|------|--------|
| Console dell'operatore | `CLAUDE.md` | Sempre (indice leggero) |
| Tabella di dispatch | `.claude/rules/index.json` | Sempre (leggibile dalla macchina) |
| Payload delle regole | `.claude/rules/*.md` | Su richiesta |

Ogni file di regole contiene i propri metadati di routing come frontmatter:

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

Quando l'agente vede un compito che menziona "CI" o "workflow", legge il file di regole corrispondente. Il resto rimane non caricato.

## Installazione

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## Utilizzo

### Analisi

Valuta le sezioni del tuo file CLAUDE.md e scopri cosa può essere estratto:

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

### Divisione

Estrazione interattiva: approvi ogni sezione prima che venga estratta:

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

Ogni estrazione proposta mostra un'anteprima, il nome file suggerito, le parole chiave e la priorità. Approvi o salti ogni elemento.

### Validazione

Verifica la directory delle regole per individuare eventuali problemi:

```bash
claude-rules validate
```

Controlla: riferimenti a file mancanti, file di regole orfani, discrepanze nel frontmatter, parole chiave vuote nelle regole di dominio, ID duplicati.

### Statistiche

Visualizza il funzionamento del tuo sistema:

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

## Livelli di priorità

| Livello | Comportamento | Esempio |
|------|----------|---------|
| `core` | Sempre incorporato nel file CLAUDE.md | "Il test è corretto fino a prova contraria" |
| `domain` | Caricato quando le parole chiave del compito corrispondono | Regole di GitHub Actions quando si modifica il CI |
| `manual` | Non caricato automaticamente, ricerca deliberata | Particolarità oscure della piattaforma |

## Come funziona il routing

L'agente vede la tabella di dispatch nel file CLAUDE.md e due segnali lo spingono a caricare un file di regole:

1. **Corrispondenza semantica** — il compito menziona "pubblicazione" o "CI"
2. **Istruzione esplicita** — il file CLAUDE.md dice "leggi quel file di regole prima di pianificare o modificare"

Questo è un sistema di suggerimenti per il ciclo dell'agente, non magia. La combinazione di corrispondenza di parole chiave e istruzioni esplicite lo rende affidabile.

## Invarianti

- Ogni sezione estratta lascia un riepilogo di 1 riga nel file CLAUDE.md
- Ogni regola `domain`/`manual` esiste in `index.json`
- Ogni regola `core` rimane incorporata (non viene mai estratta solo in un file)
- Il frontmatter è la fonte della verità; `index.json` è derivato
- Il parser divide solo in intestazioni ATX (`##`, `###`)

## Sicurezza

Questo strumento legge e scrive solo file markdown e JSON locali. Non effettua richieste di rete, non raccoglie dati di telemetria né accede a servizi esterni.

### Modello di minaccia

| Minaccia | Mitigazione |
|--------|------------|
| Perdita di dati a causa di una divisione errata | Approvazione interattiva + modalità `--dry-run` |
| File di regole malformati | Il comando `validate` rileva tutti i problemi strutturali |
| Indice obsoleto | `validate` rileva le discrepanze tra il frontmatter e `index.json` |

Consulta [SECURITY.md](SECURITY.md) per la politica di sicurezza completa.

---

Creato da [MCP Tool Shop](https://mcp-tool-shop.github.io/)
