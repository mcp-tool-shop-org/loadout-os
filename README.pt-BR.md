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

**Um Sistema Operacional de Conhecimento para agentes de codificação de IA.** Uma única interface de linha de comando (CLI) que direciona o contexto correto para o modelo sob demanda — em vez de despejar todos os arquivos de memória e regras na janela de contexto no início de cada sessão.

Seus arquivos de instruções e armazenamentos de memória crescem indefinidamente. Cada linha consome tokens em cada prompt, independentemente de ser relevante para a tarefa em questão. O loadout-os mantém um pequeno índice de despacho sempre carregado e carrega os dados mais pesados — tópicos de memória, arquivos de regras — apenas quando as palavras-chave da tarefa correspondem. Pense nisso como um conjunto de equipamentos de um jogo: equipe o agente com exatamente o conhecimento de que ele precisa para a missão.

## O que está dentro

O loadout-os unifica quatro componentes em um único binário `loadout-os`:

| Componente | O que ele faz |
|---|---|
| **Kernel** (knowledge router) | Correspondência determinística de palavras-chave/padrões, resolvedor hierárquico em camadas (global → organização → projeto → sessão) e o contrato de tempo de execução do agente. As entradas principais sempre são carregadas; as entradas de domínio são carregadas quando há correspondência; as entradas manuais são carregadas quando há uma pesquisa explícita. |
| **Memories adapter** | Transforma um armazenamento `MEMORY.md` em uma tabela de despacho legível por máquina e a valida (arquivos ausentes, arquivos órfãos, duplicados, entradas muito longas). Lê ambos os estilos de índice: os links `- [Title](file.md) — hook` do Claude Code e as referências `Name — description → path` do formato "arrow". |
| **Rules adapter** | Divide um `CLAUDE.md` inchado em um índice leve sempre carregado, além de arquivos de regras carregados sob demanda, e valida o cabeçalho em relação ao índice. |
| **Runtime hook** | Um hook `UserPromptSubmit` que injeta ≤5 linhas de ponteiro (≤200 tokens) nas entradas relevantes para o seu prompt. Falha silenciosamente: todos os caminhos de erro retornam 0, portanto, um hook com problemas nunca pode bloquear um prompt. |

Além de três rituais que mantêm a integridade do sistema: **`refresh`** (regenerar → validar → publicar o índice de despacho, com um compensador de backup), **`doctor`** (uma tela de verificação de saúde somente leitura com 8 itens) e **`report`** (observabilidade de uso/entradas inativas/orçamento de tokens).

## Interface de comando

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

> **Colisão de nomes, resolvida por namespace.** O `validate <index>` plano é o validador da estrutura de índice do kernel. Os validadores de armazenamento e regras são organizados por namespace — `memories validate <MEMORY.md>` e `rules validate` — para que os três coexistam. Execute `loadout-os <command> --help` para obter um resumo, argumentos e códigos de saída por comando.

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

A decomposição por segredos (Parnas 1972) era a solução ideal para uma equipe de N humanos. Para um operador individual mais uma equipe de LLMs, ela é operacionalmente inviável: o trabalho em vários repositórios fragmenta o contexto do agente ao longo das sessões, os adaptadores não publicados se tornam obsoletos (apenas o kernel é lançado) e o progresso é serializado entre os repositórios. Um único repositório nomeado, com uma única CLI, atende ao operador.

## Status

Lançado. O **`@mcptoolshop/loadout-os`** é publicado no npm (público) e integra o kernel, os dois adaptadores (memórias + regras) e o hook de tempo de execução ativo em uma única CLI — instale-o com `npm install -g @mcptoolshop/loadout-os`. Os três pacotes legados que ele substitui foram descontinuados: o kernel `@mcptoolshop/ai-loadout` está obsoleto no npm (ainda pode ser instalado, mas não receberá mais atualizações); `claude-memories` e `claude-rules` eram apenas locais e foram arquivados. Todo o novo trabalho será feito aqui.

## Modelo de confiança

O loadout-os é executado inteiramente em sua máquina. Não há chamadas de rede, telemetria ou conta.

- **Dados que ele acessa (apenas localmente):** seu armazenamento de memória (`MEMORY.md` + arquivos de tópico), seus arquivos de instruções (`CLAUDE.md` + `.claude/rules/`), o índice de despacho gerado ao lado do armazenamento, o índice do resolvedor global (`~/.ai-loadout/index.json`) e o log de uso somente de anexação (`~/.ai-loadout/usage.jsonl`).
- **Dados que ele NÃO acessa:** nenhuma saída de rede, nenhuma telemetria, nenhum serviço remoto, nenhuma credencial ou segredo. Nada é lido, armazenado ou transmitido para fora dos caminhos locais acima.
- **Permissões necessárias:** apenas o sistema de arquivos local. `doctor` e `report` são leituras puras (nunca gravam). As únicas gravações são os arquivos de índice, a saída interativa `rules split` e o log de uso — tudo nos locais locais esperados acima. A gravação irreversível (`refresh` publicando o índice global ativo) é protegida por uma parada de segurança em caso de falha na validação e um compensador `<dest>.bak`. O hook de tempo de execução falha silenciosamente: todos os caminhos de erro retornam `0`, portanto, ele nunca pode bloquear um prompt.

Modelo completo de ameaças e processo de relatório: [SECURITY.md](./SECURITY.md).

## Licença

MIT — corresponde a todas as fontes upstream.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
