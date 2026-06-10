<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Coloque seu arquivo CLAUDE.md em uma dieta.

`claude-rules` é um gerador de tabelas de despacho e um otimizador de arquivos de instruções para [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Ele divide arquivos de instruções grandes em um índice de roteamento pequeno (sempre carregado) e arquivos de regras específicos para cada tópico (carregados sob demanda), economizando tokens de contexto em cada sessão.

## O Problema

Os arquivos CLAUDE.md crescem com o tempo. Cada linha custa tokens em cada sessão — independentemente de ser relevante ou não. Um arquivo de instruções com 300 linhas se torna uma sobrecarga para cada pensamento do modelo.

## A Solução

Três camadas, sem ambiguidades:

| Camada | Arquivo | Carregado |
|-------|------|--------|
| Console do operador | `CLAUDE.md` | Sempre (índice leve) |
| Tabela de despacho | `.claude/rules/index.json` | Sempre (legível por máquina) |
| Conteúdo das regras | `.claude/rules/*.md` | Sob demanda |

Cada arquivo de regra contém seus próprios metadados de roteamento como cabeçalho:

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

Quando o agente vê uma tarefa que menciona "CI" ou "fluxo de trabalho", ele lê o arquivo de regra relevante. O restante permanece descarregado.

## Instalação

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## Uso

### Análise

Avalie as seções do seu arquivo CLAUDE.md e veja o que pode ser extraído:

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

### Dividir

Extração interativa — você aprova cada seção antes que ela seja extraída:

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

Cada extração proposta mostra uma visualização, o nome de arquivo sugerido, palavras-chave e prioridade. Você aprova ou ignora cada uma.

### Validação

Verifique o diretório de regras para identificar problemas:

```bash
claude-rules validate
```

Verifica: referências de arquivos ausentes, arquivos de regras órfãos, alterações no cabeçalho, palavras-chave vazias em regras de domínio, IDs duplicados.

### Estatísticas

Veja o funcionamento do seu sistema:

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

## Níveis de Prioridade

| Nível | Comportamento | Exemplo |
|------|----------|---------|
| `core` | Sempre incluído no arquivo CLAUDE.md | "O teste está correto até prova do contrário" |
| `domain` | Carregado quando as palavras-chave da tarefa correspondem | Regras do GitHub Actions ao editar o CI |
| `manual` | Nunca carregado automaticamente, busca deliberada | Problemas obscuros da plataforma |

## Como o Roteamento Funciona

O agente vê a tabela de despacho no arquivo CLAUDE.md e dois sinais o incentivam a carregar um arquivo de regra:

1. **Correspondência semântica** — a tarefa menciona "publicação" ou "CI"
2. **Instrução explícita** — o arquivo CLAUDE.md diz "leia este arquivo de regra antes de planejar ou editar"

Este é um sistema de dicas para o agente, não magia. A combinação de correspondência de palavras-chave e instrução explícita o torna confiável.

## Invariantes

- Cada seção extraída deixa um resumo de 1 linha no arquivo CLAUDE.md
- Cada regra de `domínio`/`manual` existe em `index.json`
- Cada regra `core` permanece incluída (nunca extraída apenas para um arquivo)
- O cabeçalho é a fonte da verdade; `index.json` é derivado
- O analisador divide apenas em títulos ATX (`##`, `###`)

## Segurança

Esta ferramenta lê e grava apenas arquivos Markdown e JSON locais. Ela não faz solicitações de rede, coleta dados de telemetria ou acessa serviços externos.

### Modelo de Ameaças

| Ameaça | Mitigação |
|--------|------------|
| Perda de dados devido a uma divisão incorreta | Aprovação interativa + modo `--dry-run` |
| Arquivos de regras com formatação incorreta | O comando `validate` detecta todos os problemas estruturais |
| Índice desatualizado | `validate` detecta a divergência entre o cabeçalho e o `index.json` |

Consulte [SECURITY.md](SECURITY.md) para a política de segurança completa.

---

Criado por [MCP Tool Shop](https://mcp-tool-shop.github.io/)
