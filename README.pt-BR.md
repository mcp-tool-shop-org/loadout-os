<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Seus arquivos de instrução e armazenamentos de memória crescem indefinidamente. Cada linha custa tokens em cada prompt, independentemente de ser relevante para a tarefa em questão. O loadout-os mantém um pequeno índice de despacho sempre carregado e carrega os dados mais pesados — tópicos de memória, arquivos de regras — apenas quando as palavras-chave da tarefa correspondem. Pense nisso como um conjunto de equipamentos de um jogo: equipe o agente com exatamente o conhecimento de que ele precisa para a missão.

## O que está dentro

O loadout-os unifica quatro componentes em um único binário `loadout-os`:

| Componente | O que ele faz |
|---|---|
| **Kernel** (knowledge router) | Correspondência determinística de palavras-chave/padrões, resolvedor hierárquico em camadas (global → organização → projeto → sessão) e o contrato de tempo de execução do agente. As entradas principais sempre são carregadas; as entradas de domínio são carregadas quando há correspondência; as entradas manuais são carregadas quando são pesquisadas explicitamente. |
| **Memories adapter** | Transforma um armazenamento `MEMORY.md` (mais sub-índices `index-*.md` ou `metadata.loadout_role: subindex` vinculados) em uma tabela de despacho legível por máquina e a valida (os limites de truncamento do carregador são de 180 linhas / 24 KB — aviso por padrão, erro quando ativado por meio de `--max-lines`/`--max-bytes`, cabeçalho `metadata.enforce_limits: true` ou `.loadout.json` — mais arquivos ausentes, elementos órfãos em sub-índices, resumos de tópicos desatualizados, duplicatas, entradas muito longas). |
| **Rules adapter** | Divide um `CLAUDE.md` inchado em um índice sempre carregado e arquivos de regras sob demanda, e valida o cabeçalho em relação ao índice. |
| **Runtime hooks** | Roteador de ponteiros `UserPromptSubmit` (`loadout-hook.mjs`, mesclando as camadas global e de projeto com limite de participação justa e preferência de sub-índice), `hook session-start` (injeção de UTF-8 e atualização de desatualização e edição do shell), `hook pre-compact` (aviso de desatualização antes da compactação), `hook post-write` (validador `PostToolUse` e atualização do projeto) e `hook pre-tool` (proteção da camada A/B `PreToolUse` e registro de decisões). |

Além disso, três rituais que mantêm a integridade do sistema: **`refresh`** (regenerar → validar → publicar o índice de despacho para o global ou `--project <root>`, com um compensador `.bak`, bloqueio de arquivo do SO e `--snapshot-repo` / `--mirror-repo` opcionais), **`doctor`** (uma tela de integridade somente leitura, incluindo verificações triádicas) e **`report`** (observabilidade de uso / entradas inativas / orçamento de tokens).

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
loadout-os memories split          [<MEMORY.md>] --by <rules.json> [--store <dir>] [--id-source title|name] [--dry-run] [--json]

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
loadout-os doctor [--profiles <p>] [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>]                  # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]                       # drive the runtime hook on a sample prompt
loadout-os hook session-start [--project <r>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <r>]
loadout-os hook post-write    [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix]
loadout-os hook pre-tool      [--mode enforce|log-only] [--profiles <p>] [--log <p>] [--timeout-ms <ms>]
loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--profiles <p>] [--allow-store-change] [--id-source title|name] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix] [--dry-run]
```

> **Colisão de nomes, resolvida por meio de namespaces.** O `validate <index>` plano é o validador da estrutura de índice do kernel. Os validadores de armazenamento e regras são organizados em namespaces — `memories validate <MEMORY.md>` e `rules validate` — para que os três coexistam. Execute `loadout-os <command> --help` para obter um resumo, argumentos e códigos de saída por comando.

## Conexão da memória da camada do projeto e do hook de código do Claude

Cada perfil de projeto pode manter seu próprio `.claude/loadout/index.json`, criado a partir de seu armazenamento de memória (`loadout-os refresh --store <store> --project <root>`).

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
- As entradas `core` com `metadata.loadout_inject: session-start` são injetadas por completo em `SessionStart` (e excluídas dos slots de ponteiro por prompt para que nunca prejudiquem as entradas roteadas).
- **Fonte de ID de entrada (`idSource: "title" | "name"`):** Um cabeçalho explícito `id:` sempre tem precedência. Quando `id:` é omitido, os armazenamentos global/`--dest` usam `title` por padrão (título de tópico com hífens em `MEMORY.md`, preservando os IDs de entrada `v1.0.4`), enquanto os armazenamentos `--project` usam `name` por padrão (cabeçalho com hífens `name:`). Substitua por armazenamento por meio de `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) ou cabeçalho `MEMORY.md` (`metadata.id_source: title | name`), ou por invocação por meio de `--id-source title|name` nos comandos `refresh` e `memories` (o que tem precedência sobre a configuração do armazenamento).

### 2. Blocos de hook de exemplo `.claude/settings.local.json`

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
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook pre-tool --mode enforce"
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

> **Observação sobre edições do shell:** As edições feitas nos arquivos de memória por meio de um shell (`Bash` / `PowerShell`) ignoram `PostToolUse` (`Write|Edit`). Como um fallback integrado, `loadout-os hook session-start` verifica se algum arquivo `<store>/*.md` é mais recente do que o `index.json` do projeto e atualiza automaticamente o índice do projeto (ou emite um aviso se a validação falhar).

### 3. Hook PreToolUse e `profiles.json`

`loadout-os hook pre-tool` protege as chamadas de ferramentas em processo antes da execução, passando ferramentas somente leitura e pipelines Bash somente leitura silenciosamente (`exit 0`), avaliando a tabela de regras da camada A/B por perfil ativo, registrando decisões com hash (`input_hash`, nunca o texto do comando bruto) em `~/.ai-loadout/hook-decisions.jsonl`, falhando de forma aberta antes de uma correspondência de bloco e falhando de forma fechada (`exit 2` + somente stderr) quando uma regra de bloco corresponde.

**Regras integradas:**

| ID da regra | Camada | Ferramentas | Ação padrão | Finalidade |
|---|---|---|---|---|
| `unreviewed-merge` | A | `Bash` | `warn` | Lembra de verificar uma passagem de revisão registrada (`PASS at <head8>`) antes de mesclar |
| `quote-gate` | A | `Write`, `Edit`, `MultiEdit`, `Bash` | `block` | Impede a citação literal de palestrantes configurados em artefatos ou texto de commit/PR |
| `memory-shell-write` | A | `Bash` | `block` | Impede gravações diretas do shell nos armazenamentos de memória |
| `future-stamp` | A | `Write`, `Edit`, `MultiEdit` | `block` | Impede que as ferramentas usem carimbos de data/hora mais de 5 minutos à frente do relógio do SO |
| `release-reminder` | B | `Bash` | `warn` | Lembra antes de `npm publish`, `gh release create` ou `git push --tags` |

**Perfis e configuração (`~/.ai-loadout/profiles.json`, ambiente `AI_LOADOUT_PROFILES_PATH`, `AI_LOADOUT_STORE`):**

O único perfil pré-definido é `default`. Os comandos globais `refresh` e `doctor` resolvem o armazenamento de memória padrão, com a seguinte ordem de precedência: `--store <dir>` > `AI_LOADOUT_STORE` > `defaultStore` em `profiles.json` (e rejeitam com `DEFAULT_STORE_REQUIRED` se nenhum estiver configurado; nunca derivam de `cwd`). O prefixo `cwd` mais longo correspondente seleciona o perfil ativo e as substituições opcionais de armazenamento/respostas/regras:

```json
{
  "defaultStore": "/stores/global/memory",
  "profiles": {
    "/repos/docs-site": { "profile": "docs", "store": "/stores/docs/memory" },
    "/repos/release-bot": { "profile": "release", "store": "/stores/release/memory" }
  },
  "repliesDir": "/var/log/review-replies",
  "rules": {
    "unreviewed-merge": {
      "action": { "docs": "off", "release": "warn" },
      "memory": { "release": "release-merge-policy" },
      "skill": "release-checklist",
      "note": { "release": "Verify changelog and release tag alignment before merging." }
    },
    "quote-gate": {
      "action": { "docs": "warn", "release": "block" }
    }
  },
  "ruleAliases": {
    "legacy-quote-rule": "quote-gate"
  },
  "quoteGate": {
    "speakers": ["He", "She", "They", "the User", "Maintainer"],
    "namedSpeakers": ["Maintainer"],
    "allowlistSuffixes": ["docs/quote-policy.md"]
  }
}
```

## Instalar

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

A decomposição por segredos (Parnas 1972) era a resposta ideal para uma equipe de N humanos. Para um operador individual mais uma equipe de LLM, é operacionalmente inviável: o trabalho em vários repos fragmenta o contexto do agente entre as sessões, os adaptadores não publicados se deterioram (apenas o kernel é lançado) e o progresso é serializado entre os repos. Um único repositório nomeado com um único CLI atende ao operador.

## Status

Enviado. **`@mcptoolshop/loadout-os`** é publicado no npm (público) e integra o kernel, os dois adaptadores (memórias + regras) e o hook de execução em tempo real em uma única interface de linha de comando (CLI) — instale-o com `npm install -g @mcptoolshop/loadout-os`. Os três pacotes legados que ele substitui foram descontinuados: o kernel `@mcptoolshop/ai-loadout` está obsoleto no npm (ainda pode ser instalado, mas não receberá mais atualizações); `claude-memories` e `claude-rules` eram apenas locais e foram arquivados. Todo o novo trabalho será feito aqui.

## Modelo de confiança

O loadout-os é executado inteiramente na sua máquina. Não há comunicação de rede, nem telemetria, nem conta de usuário.

- **Dados que ele acessa (apenas localmente):** seu armazenamento de memória (`MEMORY.md` + arquivos de tópico), seus arquivos de instrução (`CLAUDE.md` + `.claude/rules/`), o índice de despacho gerado ao lado do armazenamento, o índice do resolvedor global (`~/.ai-loadout/index.json`), o índice do resolvedor do projeto (`<project>/.claude/loadout/index.json`) e o registro de uso somente de adição (`~/.ai-loadout/usage.jsonl`).
- **Dados que ele NÃO acessa:** nenhuma comunicação de rede, nenhuma telemetria, nenhum serviço remoto, nenhuma credencial ou segredo. Nada é lido, armazenado ou transmitido para fora dos caminhos locais acima.
- **Permissões necessárias:** apenas o sistema de arquivos local. `doctor` e `report` são apenas leituras (nunca gravam). As únicas gravações são os arquivos de índice, a saída interativa `rules split` e o registro de uso — tudo nos locais locais esperados acima. A gravação irreversível (`refresh`, que publica o índice global ou do projeto em tempo real) é protegida por um mecanismo de interrupção em caso de falha na validação e um `<dest>.bak` compensador. Os hooks de execução do prompt e do início da sessão são de falha aberta: todos os caminhos de erro saem de `0`, para que nunca possam bloquear um prompt.

Modelo completo de ameaças e processo de relatório: [SECURITY.md](./SECURITY.md).

## Licença

MIT — corresponde a todas as fontes originais.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
