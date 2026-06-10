<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-rules/readme.png" width="400" alt="claude-rules">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/claude-rules"><img src="https://codecov.io/gh/mcp-tool-shop-org/claude-rules/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-rules"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-rules" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-rules/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Ponga su archivo CLAUDE.md a dieta.

`claude-rules` es un generador de tablas de distribución y un optimizador de archivos de instrucciones para [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Divide archivos de instrucciones voluminosos en un índice de enrutamiento pequeño (que se carga siempre) y archivos de reglas específicos de cada tema (que se cargan bajo demanda), ahorrando tokens de contexto en cada sesión.

## El problema

Los archivos CLAUDE.md crecen con el tiempo. Cada línea consume tokens en cada sesión, independientemente de si es relevante o no. Un archivo de instrucciones de 300 líneas se convierte silenciosamente en una carga para cada pensamiento del modelo.

## La solución

Tres capas, sin ambigüedades:

| Capa | Archivo | Cargado |
|-------|------|--------|
| Consola del operador | `CLAUDE.md` | Siempre (índice ligero) |
| Tabla de distribución | `.claude/rules/index.json` | Siempre (legible por máquina) |
| Cargas de reglas | `.claude/rules/*.md` | Según demanda |

Cada archivo de reglas contiene sus propios metadatos de enrutamiento como metadatos iniciales:

```markdown
---
id: github-actions
keywords: [ci, workflow, runner, dependabot]
patterns: [ci_pipeline]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# GitHub Actions Rules
CI minutes are finite...
```

Cuando el agente ve una tarea que menciona "CI" o "flujo de trabajo", lee el archivo de reglas correspondiente. El resto permanecen sin cargarse.

## Instalación

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## Uso

### Análisis

Califique las secciones de su archivo CLAUDE.md y vea qué se puede extraer:

```bash
claude-rules analyze
claude-rules analyze .claude/CLAUDE.md
```

```
File: .claude/CLAUDE.md  (258 lines, ~2388 tokens)

Keep inline (core): 4 sections
✓ (preamble)  2 lines
✓ Role  9 lines
✓ Guardian Self-Check  4 lines
✓ Document Delight  8 lines

Proposed extractions: 8 sections
  1. "GitHub Actions Rules" (L92-149, 58 lines, ~330 tokens)
     → .claude/rules/github-actions.md
     keywords: [github, actions, workflow, runner]

Budget estimate:
  Always loaded:    ~208 tokens (23 lines)
  On-demand:        ~2180 tokens (225 lines)
  Savings:          91% per session
```

### Dividir

Extracción interactiva: aprueba cada sección antes de que se extraiga:

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

Cada extracción propuesta muestra una vista previa, un nombre de archivo sugerido, palabras clave y prioridad. Aprueba o ignora cada una.

### Validación

Verifique su directorio de reglas para detectar problemas de salud:

```bash
claude-rules validate
```

Comprobaciones para: referencias de archivos faltantes, archivos de reglas huérfanos, cambios en los metadatos iniciales, palabras clave vacías en las reglas de dominio, ID duplicados.

### Estadísticas

Obtenga información sobre el funcionamiento de su sistema:

```bash
claude-rules stats
```

```
claude-rules stats

  CLAUDE.md (always loaded)
    Lines: 42    Tokens (est): 320

  Rule files (on-demand)
    github-actions           56 lines    680 tokens  domain
    shipping                 38 lines    310 tokens  domain
    ownership                28 lines    210 tokens  domain
    ──────────────────────────────────────────────────────
    Total on-demand:        122 lines  1,200 tokens

  Budget
    Always loaded:         320 tokens
    On-demand total:     1,200 tokens
    Avg task load (est):   400 tokens
    Savings vs monolithic: 79%
```

## Niveles de prioridad

| Nivel | Comportamiento | Ejemplo |
|------|----------|---------|
| `core` | Siempre incluido en CLAUDE.md | "La prueba es correcta hasta que se demuestre lo contrario" |
| `domain` | Cargado cuando las palabras clave de la tarea coinciden | Reglas de GitHub Actions al editar CI |
| `manual` | Nunca se carga automáticamente, búsqueda deliberada | Detalles oscuros de la plataforma |

## Cómo funciona el enrutamiento

El agente ve la tabla de distribución en CLAUDE.md y dos señales le indican que cargue un archivo de reglas:

1. **Coincidencia semántica** — la tarea menciona "publicación" o "CI"
2. **Instrucción explícita** — CLAUDE.md dice "lea ese archivo de reglas antes de planificar o editar"

Este es un sistema de sugerencias para el bucle del agente, no magia. La combinación de la coincidencia de palabras clave y la instrucción explícita lo hace confiable.

## Invariantes

- Cada sección extraída deja un resumen de 1 línea en CLAUDE.md
- Cada regla de `dominio`/`manual` existe en `index.json`
- Cada regla de `core` permanece incluida (nunca se extrae solo a un archivo)
- Los metadatos iniciales son la fuente de la verdad; `index.json` se deriva de ellos.
- El analizador solo divide en encabezados ATX (`##`, `###`)

## Seguridad

Esta herramienta solo lee y escribe archivos Markdown y JSON locales. No realiza solicitudes de red, recopila datos de telemetría ni accede a ningún servicio externo.

### Modelo de amenazas

| Amenaza | Mitigación |
|--------|------------|
| Pérdida de datos debido a una división incorrecta | Aprobación interactiva + modo `--dry-run` |
| Archivos de reglas con formato incorrecto | El comando `validate` detecta todos los problemas estructurales |
| Índice desactualizado | `validate` detecta la divergencia entre los metadatos iniciales y `index.json` |

Consulte [SECURITY.md](SECURITY.md) para obtener la política de seguridad completa.

---

Creado por [MCP Tool Shop](https://mcp-tool-shop.github.io/)
