<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Otimizador e gerador de tabelas de roteamento para arquivos MEMORY.md, projetado para o Claude Code.

Coloque seus arquivos MEMORY.md em uma dieta. O claude-memories analisa seus arquivos de memória, gera uma tabela de roteamento que pode ser lida por máquinas e mostra onde seu orçamento de contexto está sendo utilizado.

## O Problema

A memória automática do Claude Code cresce e se torna um arquivo MEMORY.md gigante que consome a janela de contexto. Cada sessão carrega mais de 40.000 tokens de informações — a maioria irrelevante para a tarefa atual.

## A Solução

O claude-memories indexa seus arquivos de memória em uma tabela de roteamento. Um agente pode direcionar para o tópico de memória correto sob demanda, em vez de carregar tudo.

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**Economia de 98%** em um espaço de memória com 31 tópicos.

## Instalação

```bash
npm install -g @mcptoolshop/claude-memories
```

## Comandos

### analyze

Analisa a estrutura, referências e custos de tokens do arquivo MEMORY.md.

```bash
claude-memories analyze MEMORY.md
```

### index

Gera uma tabela de roteamento (index.json) a partir de seus arquivos de memória.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

Verifica se há problemas estruturais nos arquivos de memória.

```bash
claude-memories validate MEMORY.md
```

Verifica: arquivos de tópico ausentes, arquivos órfãos, referências duplicadas, nomes vazios.

### stats

Painel de orçamento de tokens.

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

## Como Funciona

1. Analisa o arquivo MEMORY.md em busca de referências de tópicos (formato de seta: `Nome → caminho`)
2. Lê cada arquivo de tópico, extrai palavras-chave de títulos e conteúdo.
3. Gera um LoadoutIndex (tabela de roteamento) compatível com o ai-loadout.
4. Valida a integridade estrutural (arquivos ausentes, órfãos, duplicatas).

### Formato de Referência

As entradas do arquivo MEMORY.md seguem este formato:

```
Topic Name — description → `memory/topic-file.md`
```

Tanto formatos com marcadores quanto sem marcadores são suportados:

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### Frontmatter (Opcional)

Os arquivos de tópico podem incluir frontmatter para um controle mais preciso:

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

Sem frontmatter, as palavras-chave são extraídas automaticamente do nome do tópico e dos títulos.

## Arquitetura

O claude-memories é um **adaptador de Camada 2** na pilha Knowledge OS:

| Camada | Pacote | Função |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Tipos de roteamento, correspondência, validação |
| Adaptador | `@mcptoolshop/claude-rules` | Otimização de arquivos CLAUDE.md |
| Adaptador | `@mcptoolshop/claude-memories` | Otimização de arquivos MEMORY.md |

Mesmo kernel, diferentes tipos de documentos. Ambos produzem tabelas de roteamento compatíveis.

## Segurança

- **Apenas local**: Sem chamadas de rede, sem telemetria.
- **Principalmente leitura**: Escreve apenas o arquivo index.json; nunca modifica o arquivo MEMORY.md.
- **Determinístico**: Mesmas entradas → mesmas saídas.

Consulte [SECURITY.md](SECURITY.md) para o modelo de ameaças.

## Licença

MIT

---

Desenvolvido por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
