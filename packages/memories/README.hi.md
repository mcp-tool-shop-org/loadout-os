<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-memories"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-memories" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

```hindi
MEMORY.md ऑप्टिमाइज़र और क्लाउड कोड के लिए डिस्पैच टेबल जेनरेटर।

अपनी MEMORY.md को "डाइट" पर रखें। claude-memories आपकी मेमोरी फ़ाइलों का विश्लेषण करता है, एक मशीन-पठनीय डिस्पैच टेबल उत्पन्न करता है, और दिखाता है कि आपका संदर्भ बजट कहाँ खर्च होता है।

## समस्या

क्लाउड कोड की ऑटो-मेमोरी एक बड़ी MEMORY.md फ़ाइल में बदल जाती है जो संदर्भ विंडो का उपयोग करती है। प्रत्येक सत्र में 40K से अधिक टोकन की मेमोरी लोड होती है - जो अधिकांश वर्तमान कार्य के लिए अप्रासंगिक होती है।

## समाधान

claude-memories आपकी मेमोरी फ़ाइलों को एक डिस्पैच टेबल में व्यवस्थित करता है। एक एजेंट, हर चीज़ को लोड करने के बजाय, आवश्यकता पड़ने पर सही मेमोरी विषय पर जा सकता है।

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

वास्तविक 31 विषयों वाली मेमोरी वर्कस्पेस पर **98% की बचत**।

## इंस्टॉलेशन

```bash
npm install -g @mcptoolshop/claude-memories
```

## कमांड

### analyze

MEMORY.md संरचना, संदर्भों और टोकन लागतों का विश्लेषण करें।

```bash
claude-memories analyze MEMORY.md
```

### index

अपनी मेमोरी फ़ाइलों से एक डिस्पैच टेबल (index.json) उत्पन्न करें।

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

### validate

संरचनात्मक मुद्दों के लिए मेमोरी फ़ाइलों की जांच करें।

```bash
claude-memories validate MEMORY.md
```

जांच की जाती है: गुम विषय फ़ाइलें, अनाथ फ़ाइलें, डुप्लिकेट संदर्भ, खाली नाम।

### stats

टोकन बजट डैशबोर्ड।

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

## यह कैसे काम करता है

1. विषय संदर्भों (एरो प्रारूप: `नाम → पथ`) के लिए MEMORY.md का विश्लेषण करता है।
2. प्रत्येक विषय फ़ाइल को पढ़ता है, शीर्षकों और सामग्री से कीवर्ड निकालता है।
3. ai-loadout के साथ संगत एक LoadoutIndex (डिस्पैच टेबल) उत्पन्न करता है।
4. संरचनात्मक अखंडता (गुम फ़ाइलें, अनाथ, डुप्लिकेट) की जांच करता है।

### संदर्भ प्रारूप

MEMORY.md प्रविष्टियाँ इस प्रारूप का पालन करती हैं:

```
Topic Name — description → `memory/topic-file.md`
```

बिंदु वाले और गैर-बिंदु वाले दोनों प्रारूप समर्थित हैं:

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### फ्रंटमैटर (वैकल्पिक)

विषय फ़ाइलें बारीक नियंत्रण के लिए फ्रंटमैटर शामिल कर सकती हैं:

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

फ्रंटमैटर के बिना, कीवर्ड स्वचालित रूप से विषय नाम और शीर्षकों से निकाले जाते हैं।

## आर्किटेक्चर

claude-memories नॉलेज OS स्टैक में एक **लेयर 2 एडाप्टर** है:

| लेयर | पैकेज | भूमिका |
|-------|---------|------|
| कर्नेल | `@mcptoolshop/ai-loadout` | राउटिंग प्रकार, मिलान, सत्यापन |
| एडाप्टर | `@mcptoolshop/claude-rules` | CLAUDE.md अनुकूलन |
| एडाप्टर | `@mcptoolshop/claude-memories` | MEMORY.md अनुकूलन |

एक ही कर्नेल, विभिन्न दस्तावेज़ प्रकार। दोनों संगत डिस्पैच टेबल उत्पन्न करते हैं।

## सुरक्षा

- **केवल स्थानीय**: कोई नेटवर्क कॉल नहीं, कोई टेलीमेट्री नहीं।
- **मुख्य रूप से पढ़ने के लिए**: केवल index.json लिखता है; कभी भी MEMORY.md को संशोधित नहीं करता है।
- **निर्धारित**: समान इनपुट → समान आउटपुट।

खतरे के मॉडल के लिए [SECURITY.md](SECURITY.md) देखें।

## लाइसेंस

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> द्वारा निर्मित।
```
