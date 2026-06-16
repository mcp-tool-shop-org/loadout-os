<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**Un sistema operativo de conocimiento para agentes de codificación de IA.** Una única interfaz de línea de comandos (CLI) que dirige el contexto adecuado al modelo bajo demanda, en lugar de volcar todos los archivos de memoria y reglas en la ventana de contexto al inicio de cada sesión.

Tus archivos de instrucciones y almacenes de memoria crecen indefinidamente. Cada línea cuesta tokens en cada solicitud, independientemente de si es relevante para la tarea en cuestión. `loadout-os` mantiene un pequeño índice de distribución siempre cargado y carga los datos más pesados (temas de memoria, archivos de reglas) solo cuando las palabras clave de la tarea coinciden. Piensa en ello como el equipo de un juego: equipa al agente con exactamente el conocimiento que necesita para la misión que tiene por delante.

## Qué hay dentro

`loadout-os` unifica cuatro componentes bajo un único binario `loadout-os`:

| Componente | Qué hace |
|---|---|
| **Kernel** (knowledge router) | Coincidencia determinista de palabras clave/patrones, resolución jerárquica en capas (global → organización → proyecto → sesión) y el contrato de tiempo de ejecución del agente. Las entradas principales siempre se cargan; las entradas de dominio se cargan cuando hay una coincidencia; las entradas manuales se cargan mediante una búsqueda explícita. |
| **Memories adapter** | Convierte un almacén `MEMORY.md` en una tabla de distribución legible por máquina y lo valida (archivos faltantes, elementos huérfanos, duplicados, entradas demasiado largas). |
| **Rules adapter** | Divide un archivo `CLAUDE.md` inflado en un índice ligero que siempre está cargado más archivos de reglas bajo demanda y valida la información del encabezado con respecto al índice. |
| **Runtime hook** | Un "hook" `UserPromptSubmit` que inyecta ≤5 líneas de puntero (≤200 tokens) a las entradas relevantes para tu solicitud. A prueba de fallos: cada ruta de error sale con el código 0, por lo que un "hook" defectuoso nunca puede bloquear una solicitud. |

Además, tres rituales que mantienen la integridad del sistema: **`refresh`** (regenera → valida → publica el índice de distribución, con un mecanismo de compensación), **`doctor`** (una revisión de estado en modo solo lectura con 8 comprobaciones) y **`report`** (observabilidad del uso/entradas inactivas/presupuesto de tokens).

## Interfaz de línea de comandos

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

> **Conflicto de nombres, resuelto mediante el espacio de nombres.** El comando plano `validate <index>` es el validador de la estructura del índice del kernel. Los validadores de almacén y reglas tienen un espacio de nombres: `memories validate <MEMORY.md>` y `rules validate`, por lo que los tres pueden coexistir. Ejecuta `loadout-os <command> --help` para obtener una sinopsis, argumentos y códigos de salida por comando.

## Instalación

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

El kernel también se puede importar como una biblioteca: `@mcptoolshop/ai-loadout` expone `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` y los tipos de tabla de distribución.

## Documentación

- **[Manual](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)**: descripción general, instalación, arquitectura, referencia de comandos, rituales y migración desde los paquetes heredados.
- **[Repositorio](https://github.com/mcp-tool-shop-org/loadout-os)**: código fuente, hoja de ruta e incidencias.

## ¿Por qué consolidar?

La descomposición por secretos (Parnas 1972) fue la solución ideal para un equipo de N humanos. Para un operador individual más un equipo LLM, es operacionalmente inviable: el trabajo en varios repositorios fragmenta el contexto del agente entre sesiones, los adaptadores no publicados se deterioran (solo el kernel se ha publicado) y el progreso se serializa entre repositorios. Un único repositorio con nombre y una única CLI sirven al operador. El razonamiento completo se encuentra en el almacén de memoria canónico (`feedback_consolidate_when_cant_juggle_repos.md`).

## Estado

La consolidación está en curso. `loadout-os` integra el kernel y dos adaptadores que antes se encontraban como paquetes separados, además del "hook" de tiempo de ejecución activo. El paquete publicado hoy es **`@mcptoolshop/ai-loadout`** (el kernel); el paquete unificado `loadout-os` se envía desde este repositorio. Los tres binarios heredados seguirán funcionando hasta su retirada planificada.

## Modelo de confianza

`loadout-os` se ejecuta completamente en tu máquina. No hay llamadas a la red, ni telemetría y ni cuenta.

- **Datos que utiliza (solo local):** tu almacén de memoria (`MEMORY.md` + archivos de temas), tus archivos de instrucciones (`CLAUDE.md` + `.claude/rules/`), el índice de distribución generado junto al almacén, el índice del solucionador global (`~/.ai-loadout/index.json`) y el registro de uso de solo anexión (`~/.ai-loadout/usage.jsonl`).
- **Datos que NO utiliza:** no hay salida a la red, ni telemetría, ni servicios remotos, ni credenciales ni secretos. Nada se lee, almacena ni transmite fuera de las rutas locales anteriores.
- **Permisos requeridos:** solo el sistema de archivos local. `doctor` y `report` son lecturas puras (nunca escriben). Las únicas escrituras son los archivos de índice, la salida interactiva de `rules split` y el registro de uso: todo en las ubicaciones locales esperadas anteriores. La escritura irreversible (`refresh` que publica el índice global activo) está protegida por una parada "andon" en caso de fallo de validación y un mecanismo de compensación `<dest>.bak`. El "hook" de tiempo de ejecución es a prueba de fallos: cada ruta de error sale con el código `0`, por lo que nunca puede bloquear una solicitud.

Modelo completo de amenazas y proceso de notificación: [SECURITY.md](./SECURITY.md).

## Licencia

MIT, coincide con todas las fuentes anteriores.
