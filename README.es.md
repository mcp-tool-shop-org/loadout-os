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

**Un sistema operativo de conocimiento para agentes de codificación de IA.** Una única interfaz de línea de comandos (CLI) que dirige el contexto adecuado al modelo según la demanda, en lugar de volcar todos los archivos de memoria y reglas en la ventana de contexto al inicio de cada sesión.

Tus archivos de instrucciones y almacenes de memoria crecen sin límite. Cada línea cuesta tokens en cada solicitud, independientemente de si es relevante para la tarea en cuestión. loadout-os mantiene un pequeño índice de distribución siempre cargado y carga los datos más pesados (temas de memoria, archivos de reglas) solo cuando las palabras clave de la tarea coinciden. Piensa en ello como un conjunto de herramientas para un juego: equipa al agente con exactamente el conocimiento que necesita para la misión que tiene por delante.

## Qué hay dentro

loadout-os unifica cuatro componentes bajo un único archivo ejecutable `loadout-os`:

| Componente | Qué hace |
|---|---|
| **Kernel** (knowledge router) | Coincidencia determinista de palabras clave/patrones, solucionador jerárquico en capas (global → organización → proyecto → sesión) y el contrato de tiempo de ejecución del agente. Las entradas principales siempre se cargan; las entradas de dominio se cargan cuando hay una coincidencia; las entradas manuales se cargan cuando se realiza una búsqueda explícita. |
| **Memories adapter** | Convierte un almacén `MEMORY.md` (más subíndices enlazados `index-*.md` o `metadata.loadout_role: subindex`) en una tabla de distribución legible por máquina y la valida (los límites de truncamiento del cargador son de 180 líneas / 24 KB; por defecto, se muestra una advertencia; se muestra un error si se activa a través de `--max-lines`/`--max-bytes`, metadatos `metadata.enforce_limits: true` o `.loadout.json`; además, se comprueban archivos faltantes, elementos huérfanos en los subíndices, resúmenes de viñetas obsoletos, duplicados, entradas demasiado largas). |
| **Rules adapter** | Divide un archivo `CLAUDE.md` inflado en un índice ligero que se carga siempre, más archivos de reglas que se cargan según la demanda, y valida los metadatos en relación con el índice. |
| **Runtime hooks** | Enrutador de punteros `UserPromptSubmit` (`loadout-hook.mjs`, que fusiona las capas global y de proyecto con un límite de asignación justa y una preferencia de subíndice), `hook session-start` (inyección de UTF-8 y actualización de obsolescencia y edición en la terminal), `hook pre-compact` (advertencia de obsolescencia antes de la compactación) y `hook post-write` (validador `PostToolUse` y actualización del proyecto). |

Además, tres rituales que mantienen la integridad del sistema: **`refresh`** (regenerar → validar → publicar el índice de distribución en el ámbito global o `--project <root>`, con un compensador `.bak`, bloqueo de archivos del sistema operativo y, opcionalmente, `--snapshot-repo` / `--mirror-repo`), **`doctor`** (una pantalla de verificación de solo lectura con 8 comprobaciones) y **`report`** (observabilidad del uso / entradas inactivas / presupuesto de tokens).

## Interfaz de línea de comandos

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

> **Conflicto de nombres, resuelto mediante el uso de espacios de nombres.** El archivo `validate <index>` plano es el validador de la estructura de índice del núcleo. Los validadores de almacén y reglas utilizan espacios de nombres (`memories validate <MEMORY.md>` y `rules validate`), por lo que los tres pueden coexistir. Ejecuta `loadout-os <command> --help` para obtener un resumen, argumentos y códigos de salida por comando.

## Conexión de memoria de capa de proyecto y enlace de código de Claude

Cada "asiento" de proyecto puede mantener su propio archivo `.claude/loadout/index.json` creado a partir de su almacén de memoria (`loadout-os refresh --store <store> --project <root>`).

### 1. Metadatos de tema y panel

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

- Los subíndices (`index-*.md` o archivos con `metadata.loadout_role: subindex`) se expanden un nivel en el índice de distribución con `subindex: true`.
- `index-archive.md` (o un subíndice con `metadata.loadout_default_priority: manual`) establece sus entradas en `priority: "manual"` de forma predeterminada, a menos que un archivo de tema establezca explícitamente `priority:` en los metadatos.
- Las entradas `core` con `metadata.loadout_inject: session-start` se inyectan por completo en `SessionStart` (y se excluyen de las ranuras de puntero por solicitud para que nunca limiten las entradas enrutadas).
- **Origen del ID de entrada (`idSource: "title" | "name"`):** Unos metadatos explícitos `id:` siempre tienen prioridad. Cuando se omite `id:`, los almacenes globales / `--dest` tienen por defecto `title` (título de viñeta con guiones en `MEMORY.md`, conservando los ID de entrada `v1.0.4`), mientras que los almacenes `--project` tienen por defecto `name` (metadatos con guiones `name:`). Se puede anular por almacén mediante `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) o metadatos `MEMORY.md` (`metadata.id_source: title | name`), o por invocación mediante `--id-source title|name` en los comandos `refresh` y `memories` (lo que anula la configuración del almacén).

### 2. Bloques de enlace de ejemplo `.claude/settings.local.json`

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

> **Nota sobre las ediciones en la terminal:** Las ediciones realizadas en los archivos de memoria a través de una terminal (`Bash` / `PowerShell`) omiten `PostToolUse` (`Write|Edit`). Como solución integrada, `loadout-os hook session-start` comprueba si algún archivo `<store>/*.md` es más reciente que el archivo `index.json` del proyecto y actualiza automáticamente el índice del proyecto (o muestra una advertencia si la validación falla).

## Instalación

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

El núcleo también se puede importar como una biblioteca: `@mcptoolshop/ai-loadout` expone `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` y los tipos de tabla de distribución.

## Documentación

- **[Manual](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**: descripción general, instalación, arquitectura, referencia de comandos, rituales y migración desde los paquetes heredados.
- **[Repositorio](https://github.com/mcp-tool-shop-org/loadout-os)**: código fuente, hoja de ruta y problemas.

## ¿Por qué consolidar?

La descomposición por secretos (Parnas 1972) fue la solución ideal para un equipo de N humanos. Para un operador individual más un equipo de LLM, es inviable: el trabajo en varios repositorios fragmenta el contexto del agente en las sesiones, los adaptadores no publicados se deterioran (solo el núcleo se ha publicado) y el progreso se serializa entre los repositorios. Un único repositorio con nombre y una única CLI sirven al operador.

## Estado

Publicado. **`@mcptoolshop/loadout-os`** se ha publicado en npm (público) e integra el núcleo, los dos adaptadores (memorias + reglas) y el enlace de tiempo de ejecución en una única CLI; instálalo con `npm install -g @mcptoolshop/loadout-os`. Los tres paquetes heredados que reemplaza se han retirado: el núcleo `@mcptoolshop/ai-loadout` está en desuso en npm (todavía se puede instalar, pero no recibirá más actualizaciones); `claude-memories` y `claude-rules` eran de uso local y se han archivado. Todo el nuevo trabajo se realizará aquí.

## Modelo de confianza

loadout-os se ejecuta completamente en tu máquina. No hay llamadas de red, ni telemetría, ni cuentas.

- **Datos a los que accede (solo localmente):** su almacenamiento de memoria (`MEMORY.md` + archivos de tema), sus archivos de instrucciones (`CLAUDE.md` + `.claude/rules/`), el índice de distribución generado junto al almacenamiento, el índice del solucionador global (`~/.ai-loadout/index.json`), el índice del solucionador del proyecto (`<project>/.claude/loadout/index.json`) y el registro de uso de solo anexión (`~/.ai-loadout/usage.jsonl`).
- **Datos a los que NO accede:** no hay salida de red, no hay telemetría, no hay servicios remotos, no hay credenciales ni secretos. No se lee, almacena ni transmite nada fuera de las rutas de disco locales mencionadas anteriormente.
- **Permisos requeridos:** solo el sistema de archivos local. `doctor` y `report` son lecturas puras (nunca escriben). Las únicas escrituras son los archivos de índice, la salida interactiva `rules split` y el registro de uso, todo en las ubicaciones locales esperadas mencionadas anteriormente. La escritura irreversible (`refresh`, que publica el índice global o del proyecto en vivo) está protegida por una parada de andon en caso de fallo de validación y un compensador `<dest>.bak`. Los ganchos de tiempo de ejecución de inicio de sesión y solicitud son de fallo abierto: cada ruta de error sale de `0`, por lo que nunca pueden bloquear una solicitud.

Modelo de amenazas completo y proceso de informes: [SECURITY.md](./SECURITY.md).

## Licencia

MIT: coincide con todas las fuentes originales.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
