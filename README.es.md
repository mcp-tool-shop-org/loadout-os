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

**Un sistema operativo de conocimiento para agentes de codificación de IA.** Una única interfaz de línea de comandos (CLI) que dirige el contexto adecuado al modelo según la demanda, en lugar de volcar todos los archivos de memoria y reglas en la ventana de contexto al inicio de cada sesión.

Tus archivos de instrucciones y almacenes de memoria crecen sin límites. Cada línea cuesta tokens en cada solicitud, independientemente de si es relevante para la tarea en cuestión. loadout-os mantiene un pequeño índice de distribución siempre cargado y carga los datos más pesados (temas de memoria, archivos de reglas) solo cuando las palabras clave de la tarea coinciden. Piensa en ello como un conjunto de herramientas de un juego: equipa al agente con exactamente el conocimiento que necesita para la misión que tiene por delante.

## Qué hay dentro

loadout-os unifica cuatro componentes en un único `loadout-os` binario:

| Componente | Qué hace |
|---|---|
| **Kernel** (knowledge router) | Coincidencia determinista de palabras clave/patrones, solucionador jerárquico en capas (global → organización → proyecto → sesión) y el contrato de tiempo de ejecución del agente. Las entradas principales siempre se cargan; las entradas de dominio se cargan cuando hay una coincidencia; las entradas manuales se cargan mediante una búsqueda explícita. |
| **Memories adapter** | Convierte un `MEMORY.md` en una tabla de distribución legible por máquina y la valida (archivos faltantes, elementos huérfanos, duplicados, entradas demasiado largas). Lee ambos estilos de índice: los enlaces `- [Title](file.md) — hook` propios de Claude Code y las referencias `Name — description → path` de tipo "arrow". |
| **Rules adapter** | Divide un `CLAUDE.md` inflado en un índice ligero que se carga siempre, además de archivos de reglas que se cargan según la demanda, y valida la información del encabezado con respecto al índice. |
| **Runtime hook** | Un `UserPromptSubmit` que inyecta ≤5 líneas de puntero (≤200 tokens) en las entradas relevantes para tu solicitud. A prueba de fallos: cada ruta de error sale con 0, por lo que un componente defectuoso nunca puede bloquear una solicitud. |

Además, tres rituales que mantienen la integridad del sistema: **`refresh`** (regenerar → validar → publicar el índice de distribución, con un compensador de respaldo), **`doctor`** (una pantalla de verificación de salud de solo lectura con 8 comprobaciones) y **`report`** (observabilidad del uso/elementos inactivos/presupuesto de tokens).

## Interfaz de comando

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

> **Conflicto de nombres, resuelto mediante el uso de espacios de nombres.** El `validate <index>` plano es el validador de la estructura del índice del kernel. Los componentes que validan el almacén y las reglas tienen sus propios espacios de nombres (`memories validate <MEMORY.md>` y `rules validate`), por lo que los tres pueden coexistir. Ejecuta `loadout-os <command> --help` para obtener un resumen, argumentos y códigos de salida por comando.

## Instalación

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

El kernel también se puede importar como una biblioteca: `@mcptoolshop/ai-loadout` expone `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` y los tipos de tabla de distribución.

## Documentación

- **[Manual](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — descripción general, instalación, arquitectura, referencia de comandos, rituales y migración desde los paquetes heredados.
- **[Repositorio](https://github.com/mcp-tool-shop-org/loadout-os)** — código fuente, hoja de ruta y problemas.

## Por qué consolidar

La descomposición por secretos (Parnas 1972) fue la solución ideal para un equipo de N humanos. Para un operador individual más un equipo de LLM, es operacionalmente inviable: el trabajo en varios repositorios fragmenta el contexto del agente entre sesiones, los adaptadores no publicados se deterioran (solo el kernel se ha publicado) y el progreso se serializa entre repositorios. Un único repositorio con nombre y una única CLI sirven al operador.

## Estado

Publicado. **`@mcptoolshop/loadout-os`** se ha publicado en npm (público) e integra el kernel, los dos adaptadores (memorias + reglas) y el componente de tiempo de ejecución en vivo en una única CLI; instálalo con `npm install -g @mcptoolshop/loadout-os`. Los tres paquetes heredados que reemplaza se han retirado: el kernel `@mcptoolshop/ai-loadout` está en desuso en npm (todavía se puede instalar, pero no recibirá más actualizaciones); `claude-memories` y `claude-rules` eran solo locales y se han archivado. Todo el nuevo trabajo se realizará aquí.

## Modelo de confianza

loadout-os se ejecuta completamente en tu máquina. No hay llamadas de red, ni telemetría, ni cuentas.

- **Datos a los que accede (solo localmente):** tu almacén de memoria (`MEMORY.md` + archivos de temas), tus archivos de instrucciones (`CLAUDE.md` + `.claude/rules/`), el índice de distribución generado junto al almacén, el índice del solucionador global (`~/.ai-loadout/index.json`) y el registro de uso de solo anexión (`~/.ai-loadout/usage.jsonl`).
- **Datos a los que NO accede:** no hay salida de red, ni telemetría, ni servicios remotos, ni credenciales ni secretos. Nada se lee, almacena ni transmite fuera de las rutas de disco locales mencionadas anteriormente.
- **Permisos requeridos:** solo el sistema de archivos local. `doctor` y `report` son lecturas puras (nunca escriben). Las únicas escrituras son los archivos de índice, la salida interactiva de `rules split` y el registro de uso, todo en las ubicaciones locales esperadas mencionadas anteriormente. La escritura irreversible (`refresh`, que publica el índice global en vivo) está protegida por una parada de emergencia en caso de fallo de la validación y un compensador `<dest>.bak`. El componente de tiempo de ejecución es a prueba de fallos: cada ruta de error sale con `0`, por lo que nunca puede bloquear una solicitud.

Modelo de amenazas completo y proceso de notificación: [SECURITY.md](./SECURITY.md).

## Licencia

MIT — coincide con todas las fuentes originales.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
