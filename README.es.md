<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**Un sistema operativo de conocimiento para agentes de codificación de IA.** Una única interfaz de línea de comandos (CLI) que dirige el contexto adecuado al modelo según demanda, en lugar de volcar todos los archivos de memoria y reglas en la ventana de contexto al inicio de cada sesión.

Tus archivos de instrucciones y los almacenes de memoria crecen indefinidamente. Cada línea cuesta tokens en cada solicitud, independientemente de si es relevante para la tarea en cuestión. `loadout-os` mantiene un pequeño índice de distribución siempre cargado y carga los datos más pesados (temas de memoria, archivos de reglas) solo cuando las palabras clave de la tarea coinciden. Piénsalo como un conjunto de herramientas para un juego: equipa al agente con exactamente el conocimiento que necesita para la misión que tiene por delante.

## Qué hay dentro

`loadout-os` unifica cuatro componentes en un único binario `loadout-os`:

| Componente | Qué hace |
|---|---|
| **Kernel** (knowledge router) | Coincidencia determinista de palabras clave/patrones, solucionador jerárquico en capas (global → organización → proyecto → sesión) y el contrato de tiempo de ejecución del agente. Las entradas principales siempre se cargan; las entradas de dominio se cargan cuando hay una coincidencia; las entradas manuales se cargan cuando se realiza una búsqueda explícita. |
| **Memories adapter** | Convierte un almacén `MEMORY.md` (más subíndices `index-*.md` o `metadata.loadout_role: subindex` enlazados) en una tabla de distribución legible por máquina y la valida (los límites de truncamiento del cargador son de 180 líneas / 24 KB; por defecto, se muestra una advertencia; se muestra un error si se activa a través de `--max-lines`/`--max-bytes`, la cabecera `metadata.enforce_limits: true` o `.loadout.json`), además de detectar archivos faltantes, elementos huérfanos en los subíndices, resúmenes de viñetas obsoletos, duplicados y entradas demasiado largas. |
| **Rules adapter** | Divide un `CLAUDE.md` inflado en un índice ligero que se carga siempre, además de archivos de reglas que se cargan según sea necesario, y valida la cabecera con respecto al índice. |
| **Runtime hooks** | Enrutador de punteros `UserPromptSubmit` (`loadout-hook.mjs`, que combina las capas global y de proyecto con un límite de asignación justa y una preferencia de subíndice), `hook session-start` (inyección de UTF-8 y actualización de la antigüedad y la edición en la terminal), `hook pre-compact` (advertencia de antigüedad antes de la compactación), `hook post-write` (validador `PostToolUse` y actualización del proyecto) y `hook pre-tool` (protección de capa A/B de `PreToolUse` y registro de decisiones). |

Además, tres rituales que mantienen la integridad del sistema: **`refresh`** (regenerar → validar → publicar el índice de distribución en el ámbito global o `--project <root>`, con un compensador `.bak`, un bloqueo de archivos del sistema operativo y una opción de `--snapshot-repo` / `--mirror-repo`), **`doctor`** (una pantalla de estado de solo lectura que incluye tres comprobaciones) y **`report`** (observabilidad del uso / entradas inactivas / presupuesto de tokens).

## Interfaz de comandos

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

> **Conflicto de nombres, resuelto mediante el uso de espacios de nombres.** El `validate <index>` plano es el validador de la estructura de índice del núcleo. Los validadores de almacén y reglas tienen sus propios espacios de nombres (`memories validate <MEMORY.md>` y `rules validate`), por lo que los tres pueden coexistir. Ejecuta `loadout-os <command> --help` para obtener un resumen, argumentos y códigos de salida por comando.

## Conexión de memoria de capa de proyecto y conexión de código de Claude

Cada perfil de proyecto puede mantener su propio `.claude/loadout/index.json`, creado a partir de su almacén de memoria (`loadout-os refresh --store <store> --project <root>`).

### 1. Cabecera de tema y panel

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
- `index-archive.md` (o un subíndice con `metadata.loadout_default_priority: manual`) establece sus entradas en `priority: "manual"` de forma predeterminada, a menos que un archivo de tema establezca explícitamente `priority:` en la cabecera.
- Las entradas `core` con `metadata.loadout_inject: session-start` se insertan por completo en `SessionStart` (y se excluyen de las ranuras de puntero por solicitud para que nunca limiten las entradas enrutadas).
- **Origen del ID de entrada (`idSource: "title" | "name"`):** Una cabecera explícita `id:` siempre tiene prioridad. Cuando se omite `id:`, los almacenes globales / `--dest` tienen como valor predeterminado `title` (título de viñeta con guiones en `MEMORY.md`, conservando los ID de entrada `v1.0.4`), mientras que los almacenes `--project` tienen como valor predeterminado `name` (cabecera con guiones `name:`). Anula por almacén a través de `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) o la cabecera `MEMORY.md` (`metadata.id_source: title | name`), o por invocación a través de `--id-source title|name` en los comandos `refresh` y `memories` (lo que anula la configuración del almacén).

### 2. Bloques de conexión de ejemplo `.claude/settings.local.json`

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

> **Nota sobre las ediciones en la terminal:** Las ediciones realizadas en los archivos de memoria a través de una terminal (`Bash` / `PowerShell`) omiten `PostToolUse` (`Write|Edit`). Como solución integrada, `loadout-os hook session-start` comprueba si algún archivo `<store>/*.md` es más reciente que el `index.json` del proyecto y actualiza automáticamente el índice del proyecto (o muestra una advertencia si la validación falla).

### 3. Conexión PreToolUse y `profiles.json`

`loadout-os hook pre-tool` protege las llamadas a herramientas en proceso antes de la ejecución, pasando silenciosamente las herramientas de solo lectura y las canalizaciones de Bash de solo lectura (`exit 0`), evaluando la tabla de reglas de capa A/B por perfil activo, registrando las decisiones hash (`input_hash`, nunca el texto del comando sin procesar) en `~/.ai-loadout/hook-decisions.jsonl`, permitiendo el acceso si no hay una coincidencia de bloque y denegándolo (`exit 2` + solo stderr) una vez que una regla de bloque coincide.

**Reglas integradas:**

| ID de regla | Capa | Herramientas | Acción predeterminada | Propósito |
|---|---|---|---|---|
| `unreviewed-merge` | A | `Bash` | `warn` | Recuerda verificar una revisión grabada (`PASS at <head8>`) antes de combinar |
| `quote-gate` | A | `Write`, `Edit`, `MultiEdit`, `Bash` | `block` | Impide la cita literal de los oradores configurados en los artefactos o en el texto de confirmación/PR |
| `memory-shell-write` | A | `Bash` | `block` | Impide la escritura directa en la terminal en los almacenes de memoria |
| `future-stamp` | A | `Write`, `Edit`, `MultiEdit` | `block` | Impide las marcas de tiempo selladas por herramientas que tengan más de 5 minutos de anticipación con respecto al reloj del sistema operativo |
| `release-reminder` | B | `Bash` | `warn` | Recuerda antes de `npm publish`, `gh release create` o `git push --tags` |

**Perfiles y configuración (`~/.ai-loadout/profiles.json`, entorno `AI_LOADOUT_PROFILES_PATH`, `AI_LOADOUT_STORE`):**

El único perfil predefinido es `default`. Los comandos globales `refresh` y `doctor` resuelven el almacenamiento de memoria predeterminado con la siguiente prioridad: `--store <dir>` > `AI_LOADOUT_STORE` > `defaultStore` en `profiles.json` (y se rechazan con `DEFAULT_STORE_REQUIRED` si no se configura ninguno; nunca se derivan de `cwd`). El prefijo `cwd` más largo determina el perfil activo y las anulaciones opcionales del almacenamiento/respuestas/reglas:

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

La descomposición por secretos (Parnas 1972) fue la solución ideal para un equipo de N humanos. Para un operador en solitario más un equipo de LLM, es inviable: el trabajo en varios repositorios fragmenta el contexto del agente entre sesiones, los adaptadores no publicados se deterioran (solo el núcleo se ha enviado) y el progreso se serializa entre repositorios. Un único repositorio con nombre y una única CLI sirven al operador.

## Estado

Enviado. **`@mcptoolshop/loadout-os`** se publica en npm (público) e integra el núcleo, los dos adaptadores (memorias + reglas) y el hook de tiempo de ejecución en vivo en una única CLI; instálelo con `npm install -g @mcptoolshop/loadout-os`. Los tres paquetes antiguos que reemplaza se han retirado: el núcleo `@mcptoolshop/ai-loadout` está en desuso en npm (todavía se puede instalar, pero no recibirá más actualizaciones); `claude-memories` y `claude-rules` eran solo locales y se han desactivado. Todo el nuevo trabajo se realiza aquí.

## Modelo de confianza

loadout-os se ejecuta completamente en su máquina. No hay llamadas de red, ni telemetría, ni cuentas.

- **Datos a los que accede (solo localmente):** su almacenamiento de memoria (`MEMORY.md` + archivos de tema), sus archivos de instrucciones (`CLAUDE.md` + `.claude/rules/`), el índice de distribución generado junto al almacenamiento, el índice del resolvedor global (`~/.ai-loadout/index.json`), el índice del resolvedor del proyecto (`<project>/.claude/loadout/index.json`) y el registro de uso de solo adición (`~/.ai-loadout/usage.jsonl`).
- **Datos a los que NO accede:** no hay salida de red, ni telemetría, ni servicios remotos, ni credenciales ni secretos. Nada se lee, almacena ni transmite fuera de las rutas de disco locales mencionadas anteriormente.
- **Permisos requeridos:** solo el sistema de archivos local. `doctor` y `report` son lecturas puras (nunca escriben). Las únicas escrituras son los archivos de índice, la salida interactiva `rules split` y el registro de uso, todo en las ubicaciones locales esperadas mencionadas anteriormente. La escritura irreversible (`refresh`, que publica el índice global o del proyecto en tiempo real) está protegida por una parada de seguridad en caso de fallo de validación y un compensador `<dest>.bak`. Los hooks de tiempo de ejecución de inicio de sesión y de solicitud son de fallo abierto: cada ruta de error sale de `0`, por lo que nunca pueden bloquear una solicitud.

Modelo de amenazas completo y proceso de informes: [SECURITY.md](./SECURITY.md).

## Licencia

MIT: coincide con todas las fuentes originales.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
