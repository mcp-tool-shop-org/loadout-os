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

**Um Sistema Operacional de Conhecimento para agentes de codificação de IA.** Um único CLI que direciona o contexto correto para o modelo sob demanda — em vez de despejar todos os arquivos de memória e regras na janela de contexto no início de cada sessão.

Seus arquivos de instrução e armazenamentos de memória crescem indefinidamente. Cada linha consome tokens em cada prompt, independentemente de ser relevante para a tarefa em questão. O loadout-os mantém um pequeno índice de despacho sempre carregado e carrega os dados mais pesados — tópicos de memória, arquivos de regras — apenas quando as palavras-chave da tarefa correspondem. Pense nisso como um conjunto de equipamentos de um jogo: equipe o agente com exatamente o conhecimento de que ele precisa para a missão.

## O que está dentro

O loadout-os unifica quatro componentes em um único binário `loadout-os`:

| Componente | O que ele faz |
|---|---|
| **Kernel** (knowledge router) | Correspondência determinística de palavras-chave/padrões, resolvedor hierárquico em camadas (global → organização → projeto → sessão) e o contrato de tempo de execução do agente. As entradas principais são sempre carregadas; as entradas de domínio são carregadas quando há correspondência; as entradas manuais são carregadas quando há uma pesquisa explícita. |
| **Memories adapter** | Transforma um armazenamento `MEMORY.md` (mais sub-índices `index-*.md` ou `metadata.loadout_role: subindex` vinculados) em uma tabela de despacho legível por máquina e a valida (os limites de truncamento do carregador são de 180 linhas / 24 KB — aviso por padrão, erro quando ativado por meio de `--max-lines`/`--max-bytes`, cabeçalho `metadata.enforce_limits: true` ou `.loadout.json` — mais arquivos ausentes, elementos órfãos em sub-índices, resumos de tópicos desatualizados, duplicatas, entradas muito longas). |
| **Rules adapter** | Divide um `CLAUDE.md` inchado em um índice leve sempre carregado, mais arquivos de regras carregados sob demanda, e valida o cabeçalho em relação ao índice. |
| **Runtime hooks** | Roteador de ponteiros `UserPromptSubmit` (`loadout-hook.mjs`, mesclando as camadas global e de projeto com um limite de participação justa e preferência de sub-índice), `hook session-start` (injeção de UTF-8 e atualização de desatualização e edição de shell), `hook pre-compact` (aviso de desatualização antes da compactação) e `hook post-write` (validador `PostToolUse` e atualização do projeto). |

Além disso, três rituais que mantêm a integridade do sistema: **`refresh`** (regenerar → validar → publicar o índice de despacho para o global ou `--project <root>`, com um compensador `.bak`, bloqueio de arquivo do SO e `--snapshot-repo`/`--mirror-repo` opcionais), **`doctor`** (uma tela de verificação de saúde somente leitura com 8 itens) e **`report`** (observabilidade de uso/entradas inativas/orçamento de tokens).

## Superfície de comando

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

> **Colisão de nomes, resolvida por meio de namespaces.** O `validate <index>` plano é o validador da estrutura de índice do kernel. Os validadores de armazenamento e regras usam namespaces — `memories validate <MEMORY.md>` e `rules validate` — para que os três coexistam. Execute `loadout-os <command> --help` para obter um resumo, argumentos e códigos de saída por comando.

## Conexão de memória da camada do projeto e gancho de código do Claude

Cada "seat" de projeto pode manter seu próprio `.claude/loadout/index.json`, construído a partir de seu armazenamento de memória (`loadout-os refresh --store <store> --project <root>`).

### 1. Cabeçalho de tópico e quadro

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

- Os sub-índices (`index-*.md` ou arquivos com `metadata.loadout_role: subindex`) são expandidos em um nível para o índice de despacho com `subindex: true`.
- `index-archive.md` (ou um sub-índice com `metadata.loadout_default_priority: manual`) define suas entradas como `priority: "manual"`, a menos que um arquivo de tópico defina explicitamente `priority:` no cabeçalho.
- As entradas `core` com `metadata.loadout_inject: session-start` são injetadas por completo em `SessionStart` (e excluídas dos slots de ponteiro por prompt, para que nunca prejudiquem as entradas roteadas).
- **Fonte de ID de entrada (`idSource: "title" | "name"`):** Um cabeçalho explícito `id:` sempre tem precedência. Quando `id:` é omitido, os armazenamentos global/`--dest` usam `title` por padrão (título de tópico com hífens em `MEMORY.md`, preservando os IDs de entrada `v1.0.4`), enquanto os armazenamentos `--project` usam `name` por padrão (cabeçalho com hífens `name:`). Substitua por armazenamento por meio de `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) ou cabeçalho `MEMORY.md` (`metadata.id_source: title | name`), ou por invocação por meio de `--id-source title|name` nos comandos `refresh` e `memories` (o que tem precedência sobre a configuração do armazenamento).

### 2. Exemplos de blocos de gancho `.claude/settings.local.json`

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

> **Observação sobre edições de shell:** As edições feitas nos arquivos de memória por meio de um shell (`Bash` / `PowerShell`) ignoram `PostToolUse` (`Write|Edit`). Como um fallback integrado, `loadout-os hook session-start` verifica se algum arquivo `<store>/*.md` é mais recente do que o `index.json` do projeto e atualiza automaticamente o índice do projeto (ou emite um aviso se a validação falhar).

## Instalação

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

O kernel também pode ser importado como uma biblioteca — `@mcptoolshop/ai-loadout` expõe `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` e os tipos de tabela de despacho.

## Documentação

- **[Manual](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — visão geral, instalação, arquitetura, referência de comandos, rituais e migração dos pacotes legados.
- **[Repositório](https://github.com/mcp-tool-shop-org/loadout-os)** — código-fonte, roteiro e problemas.

## Por que consolidar

A decomposição por segredos (Parnas 1972) era a solução ideal para uma equipe de N humanos. Para um operador individual mais uma equipe de LLMs, ela é operacionalmente inviável: o trabalho multi-repos fragmenta o contexto do agente entre as sessões, os adaptadores não publicados se deterioram (apenas o kernel é lançado) e o avanço é serializado entre os repos. Um único repositório nomeado com um único CLI atende ao operador.

## Status

Lançado. O **`@mcptoolshop/loadout-os`** é publicado no npm (público) e integra o kernel, os dois adaptadores (memórias + regras) e o gancho de tempo de execução em um único CLI — instale-o com `npm install -g @mcptoolshop/loadout-os`. Os três pacotes legados que ele substitui foram descontinuados: o kernel `@mcptoolshop/ai-loadout` está obsoleto no npm (ainda pode ser instalado, mas não receberá mais atualizações); `claude-memories` e `claude-rules` eram locais e foram arquivados. Todo o novo trabalho será feito aqui.

## Modelo de confiança

O loadout-os é executado inteiramente em sua máquina. Não há chamadas de rede, telemetria ou conta.

- **Dados que são acessados (apenas localmente):** seu armazenamento de memória (`MEMORY.md` + arquivos de tópico), seus arquivos de instruções (`CLAUDE.md` + `.claude/rules/`), o índice de despacho gerado, localizado próximo ao armazenamento, o índice do resolvedor global (`~/.ai-loadout/index.json`), o índice do resolvedor do projeto (`<project>/.claude/loadout/index.json`) e o registro de uso, que só permite adições (`~/.ai-loadout/usage.jsonl`).
- **Dados que NÃO são acessados:** nenhum tráfego de rede, nenhuma telemetria, nenhum serviço remoto, nenhuma credencial ou segredo. Nada é lido, armazenado ou transmitido para fora dos caminhos locais especificados acima.
- **Permissões necessárias:** apenas o sistema de arquivos local. `doctor` e `report` são apenas leituras (nunca gravam). As únicas gravações são os arquivos de índice, a saída interativa `rules split` e o registro de uso — tudo nos locais locais esperados, conforme especificado acima. A gravação irreversível (`refresh`, que publica o índice global ou do projeto em tempo real) é protegida por um mecanismo de interrupção em caso de falha na validação e um `<dest>.bak` compensador. Os ganchos de tempo de execução para o prompt e o início da sessão são do tipo "fail-open": todos os caminhos de erro saem de `0`, portanto, nunca podem bloquear um prompt.

Modelo completo de ameaças e processo de relatório: [SECURITY.md](./SECURITY.md).

## Licença

MIT — corresponde a todas as fontes originais.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
