<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

अपने CLAUDE.md फ़ाइल को "आहार" पर रखें।

`claude-rules` एक डिस्पैच टेबल जेनरेटर और [Claude Code](https://docs.anthropic.com/en/docs/claude-code) के लिए इंस्ट्रक्शन-फ़ाइल ऑप्टिमाइज़र है। यह बड़ी इंस्ट्रक्शन फ़ाइलों को एक छोटे रूटिंग इंडेक्स (जो हमेशा लोड होता है) और विषय-विशिष्ट नियम फ़ाइलों (जो आवश्यकतानुसार लोड होते हैं) में विभाजित करता है, जिससे प्रत्येक सत्र में कॉन्टेक्स्ट टोकन की बचत होती है।

## समस्या

CLAUDE.md फ़ाइलें समय के साथ बढ़ती जाती हैं। प्रत्येक पंक्ति हर सत्र में टोकन की खपत करती है - चाहे वह महत्वपूर्ण हो या न हो। 300 पंक्तियों वाली एक इंस्ट्रक्शन फ़ाइल धीरे-धीरे मॉडल के हर विचार पर एक बोझ बन जाती है।

## समाधान

तीन परतें, कोई अस्पष्टता नहीं:

| परत | फ़ाइल | लोड |
|-------|------|--------|
| ऑपरेटर कंसोल | `CLAUDE.md` | हमेशा (छोटा इंडेक्स) |
| डिस्पैच टेबल | `.claude/rules/index.json` | हमेशा (मशीन-पठनीय) |
| नियम डेटा | `.claude/rules/*.md` | आवश्यकतानुसार |

प्रत्येक नियम फ़ाइल में फ्रंटमैटर के रूप में अपना रूटिंग मेटाडेटा होता है:

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

जब एजेंट किसी ऐसे कार्य को देखता है जिसमें "CI" या "वर्कफ़्लो" का उल्लेख है, तो वह संबंधित नियम फ़ाइल को पढ़ता है। बाकी अनलोड रहते हैं।

## इंस्टॉल करें

```bash
npm install -g @mcptoolshop/claude-rules
# or
npx @mcptoolshop/claude-rules analyze
```

## उपयोग

### विश्लेषण करें

अपने CLAUDE.md अनुभागों को स्कोर करें और देखें कि क्या निकाला जा सकता है:

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

### विभाजित करें

इंटरैक्टिव निष्कर्षण - प्रत्येक अनुभाग को निकालने से पहले आप उसकी मंजूरी देते हैं:

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
```

प्रत्येक प्रस्तावित निष्कर्षण में एक पूर्वावलोकन, सुझाया गया फ़ाइल नाम, कीवर्ड और प्राथमिकता दिखाई जाती है। आप प्रत्येक को स्वीकृत या छोड़ सकते हैं।

### सत्यापित करें

अपने नियमों की निर्देशिका में स्वास्थ्य संबंधी समस्याओं की जांच करें:

```bash
claude-rules validate
```

जांच की जाती है: गुम फ़ाइल संदर्भ, अनाथ नियम फ़ाइलें, फ्रंटमैटर में बदलाव, डोमेन नियमों पर खाली कीवर्ड, डुप्लिकेट आईडी।

### आंकड़े

अपनी प्रणाली के भौतिक पहलुओं को देखें:

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

## प्राथमिकता स्तर

| स्तर | व्यवहार | उदाहरण |
|------|----------|---------|
| `core` | हमेशा CLAUDE.md में इनलाइन | "परीक्षण तब तक सही है जब तक कि अन्यथा सिद्ध न हो जाए" |
| `domain` | जब कार्य कीवर्ड मेल खाते हैं तो लोड होता है | GitHub Actions नियम जब CI को संपादित किया जा रहा हो |
| `manual` | कभी भी स्वचालित रूप से लोड नहीं होता है, जानबूझकर खोज | अस्पष्ट प्लेटफ़ॉर्म संबंधी समस्याएं |

## रूटिंग कैसे काम करता है

एजेंट CLAUDE.md में डिस्पैच टेबल देखता है और दो संकेत इसे एक नियम फ़ाइल लोड करने के लिए प्रेरित करते हैं:

1. **सिमेंटिक मिलान** - कार्य में "पब्लिशिंग" या "CI" का उल्लेख है
2. **स्पष्ट निर्देश** - CLAUDE.md कहता है "योजना बनाने या संपादित करने से पहले उस नियम फ़ाइल को पढ़ें"

यह एजेंट लूप के लिए एक संकेत प्रणाली है, कोई जादू नहीं। कीवर्ड मिलान और स्पष्ट निर्देश का संयोजन इसे विश्वसनीय बनाता है।

## अपरिवर्तनीय

- प्रत्येक निकाले गए अनुभाग में CLAUDE.md में एक 1-पंक्ति सारांश छोड़ दिया जाता है।
- प्रत्येक `डोमेन`/`मैनुअल` नियम `index.json` में मौजूद होता है।
- प्रत्येक `कोर` नियम इनलाइन रहता है (केवल फ़ाइल में नहीं निकाला जाता है)।
- फ्रंटमैटर सत्य का स्रोत है; `index.json` व्युत्पन्न है।
- पार्सर केवल ATX शीर्षकों (`##`, `###`) पर विभाजित होता है।

## सुरक्षा

यह टूल केवल स्थानीय मार्कडाउन और JSON फ़ाइलों को पढ़ता और लिखता है। यह नेटवर्क अनुरोध नहीं करता है, टेलीमेट्री एकत्र नहीं करता है, या किसी भी बाहरी सेवा तक नहीं पहुंचता है।

### खतरे का मॉडल

| खतरा | शमन |
|--------|------------|
| खराब विभाजन के कारण डेटा हानि | इंटरैक्टिव अनुमोदन + `--dry-run` मोड |
| गलत नियम फ़ाइलें | `validate` कमांड सभी संरचनात्मक मुद्दों को पकड़ता है |
| पुरानी इंडेक्स | `validate` फ्रंटमैटर और index.json के बीच विचलन का पता लगाता है। |

पूर्ण सुरक्षा नीति के लिए [SECURITY.md](SECURITY.md) देखें।

---

[MCP Tool Shop](https://mcp-tool-shop.github.io/) द्वारा निर्मित
