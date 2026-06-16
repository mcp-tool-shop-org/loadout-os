<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**Um Sistema Operacional de Conhecimento para agentes de codificação de IA.** Uma única interface de linha de comando (CLI) que direciona o contexto correto para o modelo, sob demanda — em vez de despejar todos os arquivos de memória e regras na janela de contexto no início de cada sessão.

Seus arquivos de instruções e armazenamentos de memória crescem indefinidamente. Cada linha consome tokens em cada prompt, independentemente de ser relevante para a tarefa em questão. O loadout-os mantém um pequeno índice de despacho sempre carregado e carrega os dados mais pesados — tópicos de memória, arquivos de regras — apenas quando as palavras-chave da tarefa correspondem. Pense nisso como um conjunto de equipamentos de um jogo: equipe o agente com exatamente o conhecimento de que ele precisa para a missão.

## O que está dentro

O loadout-os unifica quatro componentes em um único binário `loadout-os`:

| Componente | O que ele faz |
|---|---|
| **Kernel** (knowledge router) | Correspondência determinística de palavras-chave/padrões, resolvedor hierárquico em camadas (global → organização → projeto → sessão) e o contrato de tempo de execução do agente. As entradas principais são sempre carregadas; as entradas de domínio são carregadas quando há correspondência; as entradas manuais são carregadas mediante pesquisa explícita. |
| **Memories adapter** | Transforma um armazenamento `MEMORY.md` em uma tabela de despacho legível por máquina e o valida (arquivos ausentes, arquivos órfãos, duplicados, entradas muito longas). |
| **Rules adapter** | Divide um arquivo `CLAUDE.md` volumoso em um índice leve sempre carregado mais arquivos de regras sob demanda e valida o cabeçalho em relação ao índice. |
| **Runtime hook** | Um hook `UserPromptSubmit` que injeta ≤5 linhas de ponteiro (≤200 tokens) nas entradas relevantes para seu prompt. Falha silenciosamente: todos os caminhos de erro retornam 0, portanto, um hook com problemas nunca pode bloquear um prompt. |

Além disso, três rituais que mantêm a integridade do sistema: **`refresh`** (regenera → valida → publica o índice de despacho, com uma compensação de backup), **`doctor`** (uma verificação de saúde em leitura pura) e **`report`** (observabilidade de uso/entradas inativas/orçamento de tokens).

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

> **Colisão de nomes, resolvida por namespace.** O comando `validate <index>` é o validador da estrutura do índice do kernel. Os validadores de armazenamento e regras usam namespaces — `memories validate <MEMORY.md>` e `rules validate` — para que os três coexistam. Execute `loadout-os <command> --help` para obter um resumo, argumentos e códigos de saída por comando.

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

A decomposição por segredos (Parnas 1972) era a solução ideal para uma equipe de N humanos. Para um operador individual mais uma equipe LLM, ela é operacionalmente inviável: o trabalho multi-repos fragmenta o contexto do agente entre as sessões, os adaptadores não publicados se tornam obsoletos (apenas o kernel é lançado) e o avanço ocorre em série entre os repositórios. Um único repositório nomeado com uma única CLI atende ao operador. O raciocínio completo está armazenado no armazenamento de memória canônico (`feedback_consolidate_when_cant_juggle_repos.md`).

## Status

Consolidação em andamento. O loadout-os integra o kernel e dois adaptadores que antes existiam como pacotes separados, além do hook de tempo de execução ativo. A versão publicada hoje é **`@mcptoolshop/ai-loadout`** (o kernel); o pacote unificado `loadout-os` será lançado a partir deste repositório. Os três binários legados continuarão funcionando até sua aposentadoria planejada.

## Modelo de confiança

O loadout-os é executado inteiramente em sua máquina. Não há chamadas de rede, telemetria ou conta.

- **Dados que ele acessa (apenas localmente):** seu armazenamento de memória (`MEMORY.md` + arquivos de tópicos), seus arquivos de instruções (`CLAUDE.md` + `.claude/rules/`), o índice de despacho gerado ao lado do armazenamento, o índice do resolvedor global (`~/.ai-loadout/index.json`) e o log de uso somente em anexo (`~/.ai-loadout/usage.jsonl`).
- **Dados que ele NÃO acessa:** nenhuma saída de rede, telemetria, serviços remotos, credenciais ou segredos. Nada é lido, armazenado ou transmitido para fora dos caminhos locais acima.
- **Permissões necessárias:** apenas o sistema de arquivos local. `doctor` e `report` são leituras puras (eles nunca gravam). As únicas gravações são os arquivos de índice, a saída interativa do comando `rules split` e o log de uso — tudo nos locais locais esperados acima. A gravação irreversível (`refresh` publicando o índice global ativo) é protegida por um halt andon em caso de falha na validação e uma compensação `<dest>.bak`. O hook de tempo de execução falha silenciosamente: todos os caminhos de erro retornam `0`, portanto, ele nunca pode bloquear um prompt.

Modelo completo de ameaças e processo de relatório: [SECURITY.md](./SECURITY.md).

## Licença

MIT — corresponde a todas as fontes upstream.
