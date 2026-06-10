<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

एआई एजेंटों के लिए संदर्भ-जागरूक ज्ञान मार्गदर्शक प्रणाली।

`ai-loadout` ज्ञान प्रणाली (नॉलेज ओएस) के मूल ढांचे का हिस्सा है - इसमें डिस्पैच टेबल का प्रारूप, मिलान इंजन, पदानुक्रमित समाधानकर्ता (हायरार्किकल रिजॉल्वर) और एजेंट रनटाइम अनुबंध शामिल हैं। इसके बजाय कि आप सब कुछ संदर्भ में डाल दें, आप एक छोटा सा इंडेक्स रखते हैं और आवश्यकतानुसार डेटा लोड करते हैं।

इसे एक तरह के गेम में इस्तेमाल होने वाले उपकरणों की तरह समझें— आप एजेंट को हर मिशन से पहले वही जानकारी देते हैं जिसकी उसे आवश्यकता होती है।

## स्थापित करें।

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## मुख्य अवधारणाएं।

### डिस्पैच टेबल।

एक `LoadoutIndex` ज्ञान के संग्रह का एक संरचित सूचकांक है:

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

### प्राथमिकता स्तर।

| स्तर। | व्यवहार। | उदाहरण। |
|------|----------|---------|
| `core` | हमेशा तैयार। | "जांचों को कभी भी न छोड़ें, ताकि निरंतर एकीकरण (सीआई) प्रक्रिया सुचारू रूप से चलती रहे।" |
| `domain` | यह तभी लोड होगा जब कार्य से संबंधित कीवर्ड मेल खाएंगे। | सीआई (CI) नियमों का पालन करते हुए वर्कफ़्लो को संपादित करना। |
| `manual` | यह स्वचालित रूप से लोड नहीं होता है, केवल स्पष्ट रूप से खोजा जा सकता है। | अपरिचित प्लेटफॉर्म की जटिलताएं। |

### पेलोड का प्रारंभिक भाग।

प्रत्येक डेटा फ़ाइल में अपने स्वयं के रूटिंग संबंधी जानकारी (मेटाडेटा) शामिल होता है:

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

"फ्रंट मैटर" (प्रारंभिक सामग्री) ही सत्य का स्रोत है। अनुक्रमणिका (इंडेक्स) इसी से बनाई जाती है।

## एजेंट रनटाइम (मुख्य एपीआई)

"रनटाइम" वह मानक तरीका है जिससे एजेंट किसी विशेष कार्य के लिए आवश्यक संसाधनों (लोडआउट) का उपयोग करते हैं। यह पूरी प्रक्रिया को शामिल करता है: परतों को निर्धारित करना → कार्य का मिलान करना → यह तय करना कि क्या लोड करना है → उपयोग का रिकॉर्ड रखना।

### `planLoad(कार्य, विकल्प?)`

किसी विशेष कार्य के लिए क्या सामग्री लोड करनी है, इसकी योजना बनाएं। यह मुख्य रूप से उपयोगकर्ता के लिए उपयोगी एक सुविधा है।

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

यह एक `LoadPlan` लौटाता है जिसमें निम्नलिखित जानकारी शामिल होती है:

- `preload` / `onDemand` / `manual` — लोड मोड के आधार पर अलग-अलग प्रविष्टियाँ।
- `provenance` — प्रत्येक प्रविष्टि किस लेयर से आई है।
- `budget` — हल किए गए इंडेक्स के लिए टोकन बजट।
- `preloadTokens` / `onDemandTokens` — टोकन की कुल लागत।
- `layerNames` / `conflicts` — लेयर से संबंधित मेटाडेटा।

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)` का हिंदी में अनुवाद:

`recordLoad(एंट्री आईडी, ट्रिगर, मोड, टोकन अनुमानित, विकल्प?)`

यह रिकॉर्ड करता है कि किसी एजेंट ने एक प्रविष्टि (एंट्री) जोड़ी है। यह निगरानी (मॉनिटरिंग) की सुविधा प्रदान करता है (जैसे, अमान्य प्रविष्टियाँ, बजट में विचलन, आवृत्ति का पता लगाना)। वैकल्पिक: यह केवल तभी डेटा लिखता है जब `usagePath` विकल्प में निर्दिष्ट किया गया हो।

### `manualLookup(आईडी, विकल्प?)`

निश्चित पहचान संख्या (आईडी) के आधार पर, हल किए गए इंडेक्स से मैन्युअल रूप से दर्ज की गई जानकारी को सीधे लोड करें।

## समाधान करना।

यह सुविधा एक मानक लेयर संरचना से लोडआउट इंडेक्स को खोजती है और उन्हें एक साथ मिलाती है।

1. **वैश्विक (ग्लोबल):** `~/.ai-loadout/index.json`
2. **संगठन (ऑर्ग):** स्पष्ट पथ या `$AI_LOADOUT_ORG`
3. **परियोजना (प्रोजेक्ट):** `<cwd>/.claude/loadout/index.json`
4. **सत्र (सेशन):** स्पष्ट पथ या `$AI_LOADOUT_SESSION`

बाद की परतें (लेयर्स) बेहतर होती हैं। छूटी हुई परतें सामान्य हैं।

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## मेल खाना।

### `matchLoadout(कार्य, सूचकांक)`

किसी कार्य के विवरण को उपकरण सूची (लोडआउट इंडेक्स) से मिलाएं। यह उन प्रविष्टियों को सूचीबद्ध करता है जिन्हें उनकी अनुकूलता के आधार पर क्रमबद्ध किया गया है।

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- मुख्य प्रविष्टियाँ हमेशा शामिल की जाती हैं (स्कोर 1.0)।
- मैन्युअल रूप से दर्ज की गई प्रविष्टियाँ कभी भी स्वचालित रूप से शामिल नहीं की जाती हैं।
- डोमेन प्रविष्टियों का मूल्यांकन कीवर्ड के मिलान और पैटर्न बोनस के आधार पर किया जाता है।
- परिणाम स्कोर के आधार पर अवरोही क्रम में, और फिर टोकन लागत के आधार पर आरोही क्रम में छांटे जाते हैं।

### `lookupEntry(आईडी, इंडेक्स)`

किसी विशिष्ट प्रविष्टि को उसकी आईडी के माध्यम से खोजें। यह सुविधा उन प्रविष्टियों के लिए है जिन्हें मैन्युअल रूप से जोड़ा गया है या जिनके लिए विशेष पहुंच की आवश्यकता है।

## अवलोकनीयता।

### `recordUsage()` / `readUsage()` / `summarizeUsage()` का हिंदी में अनुवाद:

`उपयोग का रिकॉर्ड करें()` / `उपयोग पढ़ें()` / `उपयोग का सारांश प्रस्तुत करें()`

केवल जोड़ने की अनुमति वाले JSONL प्रारूप में उपयोग का लॉग। यह कभी भी नेटवर्क से जुड़ा नहीं होता और न ही इसमें कोई संदिग्ध गतिविधि होती है।

### `findDeadEntries(इंडेक्स, इवेंट्स)`

उन प्रविष्टियों को खोजें जिन्हें कभी भी लोड नहीं किया गया है।

### `findKeywordOverlaps(इंडेक्स)`

उन शब्दों (कीवर्ड) को खोजें जो विभिन्न प्रविष्टियों में समान रूप से उपयोग किए गए हैं (राउटिंग संबंधी अस्पष्टताएं)।

### `analyzeBudget(इंडेक्स, उपयोग?)`

टोकन बजट का विस्तृत विवरण, जिसमें वास्तविक उपयोग की तुलना अनुमानित उपयोग से की गई है।

## विलय करें।

### `mergeIndexes(लेयर्स)` (या "लेयर्स" नामक डेटा संरचनाओं को मिलाकर इंडेक्स बनाना)

नियतात्मक विलय, जो पदानुक्रमित लोडआउट के लिए है। यह `MergedIndex` लौटाता है, जिसमें उत्पत्ति का पता लगाने और टकराव की रिपोर्टिंग की सुविधा होती है।

## उपकरण

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

पेयलोड फ़ाइलों से YAML-जैसे फ्रंटमैटर को पार्स और सीरियल करें।

### `validateIndex(index)`

`LoadoutIndex` की संरचनात्मक अखंडता को मान्य करें। जांच: आवश्यक फ़ील्ड, अद्वितीय आईडी, केबाब-केस प्रारूप, सारांश सीमाएं, डोमेन प्रविष्टियों के लिए कीवर्ड की उपस्थिति, मान्य प्राथमिकताएं, गैर-नकारात्मक बजट।

### `estimateTokens(text)`

टेक्स्ट से टोकन की संख्या का अनुमान लगाएं। यह chars/4 अनुमान का उपयोग करता है।

## कमांड-लाइन इंटरफेस (CLI)

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

सभी कमांड स्क्रिप्टिंग के लिए `--json` का समर्थन करते हैं। रिज़ॉल्वर कमांड `--project`, `--global`, `--org`, `--session` स्वीकार करते हैं।

## प्रकार

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

## उपभोक्ता

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — क्लाउड कोड के लिए CLAUDE.md ऑप्टिमाइज़र। यह डिस्पैच टेबल और मिलान के लिए ai-loadout का उपयोग करता है।
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — क्लाउड कोड के लिए MEMORY.md ऑप्टिमाइज़र। यह मेमोरी टॉपिक फ़ाइलों से डिस्पैच टेबल उत्पन्न करता है।

## सुरक्षा

मुख्य मिलान, विलय और सत्यापन मॉड्यूल शुद्ध फ़ंक्शन हैं जिनमें कोई दुष्प्रभाव नहीं है। उपयोग मॉड्यूल (`recordUsage` / `readUsage`) केवल JSONL लॉग में स्थानीय फ़ाइल सिस्टम I/O करता है। रिज़ॉल्वर मानक पथों से इंडेक्स फ़ाइलें पढ़ता है। कोई नेटवर्क अनुरोध नहीं, कोई टेलीमेट्री नहीं, कोई देशी निर्भरता नहीं।

### खतरे का मॉडल

| खतरा | शमन |
|--------|------------|
| गलत फ्रंटमैटर इनपुट | `parseFrontmatter()` अमान्य इनपुट पर `null` लौटाता है — कोई अपवाद नहीं, कोई eval नहीं। |
| प्रोटोटाइप प्रदूषण | हाथ से बनाया गया पार्सर, सादे ऑब्जेक्ट लिटरल का उपयोग करता है, अविश्वसनीय इनपुट का कोई पुनरावर्ती विलय नहीं। |
| खराब डेटा वाला इंडेक्स | `validateIndex()` संरचनात्मक मुद्दों को फैलने से पहले पकड़ लेता है। |
| रेगेक्स DoS | कोई उपयोगकर्ता-प्रदत्त रेगेक्स नहीं — पैटर्न को सादे स्ट्रिंग लुकअप के रूप में मिलान किया जाता है। |

पूर्ण सुरक्षा नीति के लिए [SECURITY.md](SECURITY.md) देखें।

---

[MCP Tool Shop](https://mcp-tool-shop.github.io/) द्वारा निर्मित।
