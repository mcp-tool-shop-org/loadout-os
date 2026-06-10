<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-loadout/readme.png" width="400" alt="ai-loadout">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout"><img src="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/ai-loadout"><img src="https://img.shields.io/npm/v/@mcptoolshop/ai-loadout" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-loadout/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Enrutador de conocimiento contextual para agentes de IA.

`ai-loadout` es el núcleo de la pila Knowledge OS: formato de tabla de despacho, motor de coincidencia, resolutor jerárquico y contrato de tiempo de ejecución del agente. En lugar de incluir todo en el contexto, se mantiene un índice pequeño y se cargan los datos según sea necesario.

Piénselo como la configuración de un juego: se equipa al agente con exactamente el conocimiento que necesita antes de cada misión.

## Instalación

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Conceptos clave

### La tabla de despacho

Un `LoadoutIndex` es un índice estructurado de datos de conocimiento:

```json
{
  "version": "1.0.0",
  "generated": "2026-03-06T12:00:00Z",
  "entries": [
    {
      "id": "github-actions",
      "path": ".rules/github-actions.md",
      "keywords": ["ci", "workflow", "runner"],
      "patterns": ["ci_pipeline"],
      "priority": "domain",
      "summary": "CI triggers, path gating, runner cost control",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 680,
      "lines": 56
    }
  ],
  "budget": {
    "always_loaded_est": 320,
    "on_demand_total_est": 8100,
    "avg_task_load_est": 520,
    "avg_task_load_observed": null
  }
}
```

### Niveles de prioridad

| Nivel | Comportamiento | Ejemplo |
|------|----------|---------|
| `core` | Cargado siempre | "nunca omitir pruebas para que la integración continua sea exitosa" |
| `domain` | Cargado cuando las palabras clave de la tarea coinciden | Reglas de integración continua al editar flujos de trabajo |
| `manual` | Nunca cargado automáticamente, solo búsqueda explícita | Aspectos técnicos oscuros de la plataforma |

### Metadatos del dato

Cada archivo de dato contiene sus propios metadatos de enrutamiento:

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

El metadato es la fuente de la verdad. El índice se deriva de él.

## Tiempo de ejecución del agente (API principal)

El tiempo de ejecución es la forma canónica en que los agentes consumen una configuración. Envuelve toda la secuencia: resolver capas → coincidir con la tarea → decidir qué cargar → registrar el uso.

### `planLoad(tarea, opciones?)`

Planifica qué cargar para una tarea determinada. Esta es la función principal que utiliza el agente.

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

Devuelve un `LoadPlan` con:
- `preload` / `onDemand` / `manual` — entradas separadas por modo de carga
- `provenance` — de qué capa proviene cada entrada
- `budget` — presupuesto de tokens para el índice resuelto
- `preloadTokens` / `onDemandTokens` — costos totales de tokens
- `layerNames` / `conflicts` — metadatos de la capa

### `recordLoad(idEntrada, disparador, modo, tokensEstimados, opciones?)`

Registra que un agente cargó una entrada. Permite la observabilidad (entradas no utilizadas, desviación del presupuesto, seguimiento de la frecuencia). Opcional: solo escribe cuando `usagePath` está configurado en las opciones.

### `manualLookup(id, opciones?)`

Carga explícitamente una entrada manual por ID del índice resuelto.

## Resolutor

Descubre y combina índices de configuración de una pila de capas canónica:

1. **global** — `~/.ai-loadout/index.json`
2. **org** — ruta explícita o `$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — ruta explícita o `$AI_LOADOUT_SESSION`

Las capas posteriores tienen prioridad. Las capas faltantes son normales.

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## Coincidencia

### `matchLoadout(tarea, índice)`

Coincide una descripción de la tarea con un índice de configuración. Devuelve entradas clasificadas por la fuerza de la coincidencia.

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- Las entradas principales siempre se incluyen (puntuación 1.0)
- Las entradas manuales nunca se incluyen automáticamente
- Las entradas de dominio se puntúan por la superposición de palabras clave + bono de patrón
- Los resultados se ordenan por puntuación descendente, luego por costo de token ascendente

### `lookupEntry(id, índice)`

Busca una entrada específica por ID. Para entradas manuales o acceso explícito.

## Observabilidad

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

Registro de uso JSONL de solo anexión. Nunca se conecta a la red, nunca es intrusivo.

### `findDeadEntries(índice, eventos)`

Encuentra entradas que nunca se han cargado.

### `findKeywordOverlaps(índice)`

Encuentra palabras clave compartidas entre entradas (ambigüedades de enrutamiento).

### `analyzeBudget(índice, uso?)`

Desglose del presupuesto de tokens con comparación entre lo observado y lo estimado.

## Combinar

### `mergeIndexes(capas)`

Fusión determinista para configuraciones jerárquicas. Devuelve un `MergedIndex` con seguimiento de origen y reporte de conflictos.

## Utilidades

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

Analiza y serializa la información de encabezado en formato YAML de los archivos de carga.

### `validateIndex(index)`

Valida la integridad estructural de un `LoadoutIndex`. Verifica: campos obligatorios, IDs únicos, formato kebab-case, límites del resumen, presencia de palabras clave para las entradas de dominio, prioridades válidas, presupuestos no negativos.

### `estimateTokens(text)`

Estima el número de tokens a partir del texto. Utiliza la heurística de caracteres/4.

## Interfaz de línea de comandos (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

Todos los comandos admiten `--json` para la automatización. Los comandos de resolución aceptan `--project`, `--global`, `--org`, `--session`.

## Tipos

```typescript
import type {
  LoadoutEntry,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  ValidationIssue,
  Priority,          // "core" | "domain" | "manual"
  Triggers,          // { task, plan, edit }
  LoadMode,          // "eager" | "lazy" | "manual"
  Budget,
  UsageEvent,
  MergeConflict,
  MergedIndex,
  LoadPlan,          // returned by planLoad()
  ResolvedLoadout,   // returned by resolveLoadout()
  EntryExplanation,  // returned by explainEntry()
  IssueSeverity,     // "error" | "warning"
  RuntimeOptions,    // options for planLoad / recordLoad / manualLookup
  ResolveOptions,    // options for resolveLoadout / discoverLayers
  UsageSummary,      // returned by summarizeUsage()
  DeadEntry,         // returned by findDeadEntries()
  KeywordOverlap,    // returned by findKeywordOverlaps()
  BudgetBreakdown,   // returned by analyzeBudget()
  DiscoveredLayer,   // a layer found and loaded by the resolver
  SearchedLayer,     // a layer search location and its result
  EntryDefinition,   // one layer's version of a specific entry
} from "@mcptoolshop/ai-loadout";
```

## Consumidores

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — Optimizador de CLAUDE.md para Claude Code. Utiliza ai-loadout para la tabla de distribución y la coincidencia.
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — Optimizador de MEMORY.md para Claude Code. Genera tablas de distribución a partir de archivos de temas de memoria.

## Seguridad

Los módulos principales de coincidencia, fusión y validación son funciones puras sin efectos secundarios. El módulo de uso (`recordUsage` / `readUsage`) realiza operaciones de entrada/salida en el sistema de archivos local para un registro JSONL de solo escritura. El resolvedor lee los archivos de índice de rutas de capa canónicas. No hay solicitudes de red, ni telemetría, ni dependencias nativas.

### Modelo de Amenazas

| Amenaza | Mitigación |
|--------|------------|
| Información de encabezado incorrecta | `parseFrontmatter()` devuelve `null` en caso de entrada inválida; no se generan excepciones ni se utiliza `eval`. |
| Contaminación de prototipos | El analizador personalizado utiliza literales de objetos simples; no se realiza una fusión recursiva de entradas no confiables. |
| Índice con datos incorrectos | `validateIndex()` detecta problemas estructurales antes de que se propaguen. |
| Ataque de denegación de servicio (DoS) con expresiones regulares | No se utilizan expresiones regulares proporcionadas por el usuario; los patrones se comparan como búsquedas de cadenas simples. |

Consulte [SECURITY.md](SECURITY.md) para obtener la política de seguridad completa.

---

Desarrollado por [MCP Tool Shop](https://mcp-tool-shop.github.io/)
