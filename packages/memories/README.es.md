<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Optimizador y generador de tablas de distribución para MEMORY.md, diseñado para Claude Code.

Ponga su archivo MEMORY.md a dieta. claude-memories analiza sus archivos de memoria, genera una tabla de distribución legible por máquina y le muestra dónde se consume su presupuesto de contexto.

## El problema

La función de memoria automática de Claude Code crea un archivo MEMORY.md muy grande que consume espacio en la ventana de contexto. Cada sesión carga más de 40.000 tokens de información, la mayoría de los cuales no son relevantes para la tarea actual.

## La solución

claude-memories indexa sus archivos de memoria en una tabla de distribución. Un agente puede acceder al tema de memoria correcto según sea necesario, en lugar de cargar toda la información.

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**Ahorro del 98%** en un espacio de trabajo de memoria con 31 temas.

## Instalación

```bash
npm install -g @mcptoolshop/claude-memories
```

## Comandos

### analyze

Analiza la estructura, las referencias y los costos de tokens del archivo MEMORY.md.

```bash
claude-memories analyze MEMORY.md
```

### index

Genera una tabla de distribución (index.json) a partir de sus archivos de memoria.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

Verifica la estructura de los archivos de memoria en busca de problemas.

```bash
claude-memories validate MEMORY.md
```

Comprueba: archivos de tema faltantes, archivos huérfanos, referencias duplicadas, nombres vacíos.

### stats

Panel de control del presupuesto de tokens.

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

## Cómo funciona

1. Analiza el archivo MEMORY.md en busca de referencias a temas (formato de flecha: `Nombre → ruta`).
2. Lee cada archivo de tema, extrae palabras clave de los encabezados y el contenido.
3. Genera un LoadoutIndex (tabla de distribución) compatible con ai-loadout.
4. Valida la integridad estructural (archivos faltantes, archivos huérfanos, duplicados).

### Formato de referencia

Las entradas del archivo MEMORY.md siguen este formato:

```
Topic Name — description → `memory/topic-file.md`
```

Se admiten tanto formatos con viñetas como sin viñetas:

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### Prefacio (Opcional)

Los archivos de tema pueden incluir un prefacio para un control más preciso:

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

Si no se incluye un prefacio, las palabras clave se extraen automáticamente del nombre del tema y de los encabezados.

## Arquitectura

claude-memories es un **adaptador de Capa 2** en la pila Knowledge OS:

| Capa | Paquete | Rol |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Tipos de enrutamiento, coincidencia, validación |
| Adaptador | `@mcptoolshop/claude-rules` | Optimización de CLAUDE.md |
| Adaptador | `@mcptoolshop/claude-memories` | Optimización de MEMORY.md |

Mismo kernel, diferentes tipos de documentos. Ambos producen tablas de distribución compatibles.

## Seguridad

- **Solo local**: No realiza llamadas de red, no recopila datos de telemetría.
- **Principalmente de lectura**: Solo escribe el archivo index.json; nunca modifica el archivo MEMORY.md.
- **Determinista**: Las mismas entradas siempre producen las mismas salidas.

Consulte [SECURITY.md](SECURITY.md) para obtener información sobre el modelo de amenazas.

## Licencia

MIT

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
