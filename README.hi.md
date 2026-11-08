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

**एआई कोडिंग एजेंटों के लिए एक नॉलेज ओएस।** एक CLI जो आवश्यकतानुसार मॉडल को सही संदर्भ प्रदान करता है — प्रत्येक सत्र की शुरुआत में हर मेमोरी फ़ाइल और नियम को संदर्भ विंडो में डालने के बजाय।

आपकी निर्देश फ़ाइलें और मेमोरी स्टोर असीमित रूप से बढ़ती हैं। प्रत्येक पंक्ति हर प्रॉम्प्ट पर टोकन की लागत लगाती है, चाहे वह वर्तमान कार्य के लिए प्रासंगिक हो या नहीं। लोडआउट-ओएस हमेशा एक छोटा सा डिस्पैच इंडेक्स लोड रखता है और केवल तभी भारी डेटा — मेमोरी विषय, नियम फ़ाइलें — लोड करता है जब कार्य कीवर्ड मेल खाते हैं। इसे एक गेम लोडआउट की तरह समझें: एजेंट को ठीक उसी ज्ञान से लैस करें जिसकी उसे आगामी मिशन के लिए आवश्यकता है।

## इसके अंदर क्या है

लोडआउट-ओएस एक `loadout-os` बाइनरी के तहत चार सतहों को एकीकृत करता है:

| सतह | यह क्या करता है |
|---|---|
| **Kernel** (knowledge router) | निर्धारित कीवर्ड/पैटर्न मिलानकर्ता, पदानुक्रमित लेयर्ड रिज़ॉल्वर (वैश्विक → संगठन → परियोजना → सत्र), और एजेंट रनटाइम अनुबंध। मुख्य प्रविष्टियाँ हमेशा लोड होती हैं; डोमेन प्रविष्टियाँ मिलान पर लोड होती हैं; मैन्युअल प्रविष्टियाँ स्पष्ट लुकअप पर लोड होती हैं। |
| **Memories adapter** | एक `MEMORY.md` स्टोर (साथ ही जुड़े `index-*.md` या `metadata.loadout_role: subindex` सब-इंडेक्स) को मशीन-पठनीय डिस्पैच तालिका में बदलता है और इसे मान्य करता है (लोडर ट्रंकेशन सीमा 180 पंक्तियाँ / 24 KB पर — डिफ़ॉल्ट रूप से चेतावनी, `--max-lines`/`--max-bytes`, फ्रंटमैटर `metadata.enforce_limits: true`, या `.loadout.json` के माध्यम से ऑप्ट-इन करने पर त्रुटि)। |
| **Rules adapter** | एक अति-विस्तृत `CLAUDE.md` को एक दुबले, हमेशा लोड होने वाले इंडेक्स और ऑन-डिमांड नियम फ़ाइलों में विभाजित करता है, और इंडेक्स के विरुद्ध फ्रंटमैटर को मान्य करता है। |
| **Runtime hooks** | `UserPromptSubmit` पॉइंटर राउटर (`loadout-hook.mjs`, उचित-शेयर कैप और सब-इंडेक्स प्राथमिकता के साथ वैश्विक + परियोजना परतों का विलय), `hook session-start` (UTF-8 बोर्ड इंजेक्शन + अप्रचलन और शेल-एडिट रीफ़्रेश), `hook pre-compact` (कॉम्पैक्शन से पहले अप्रचलन चेतावनी), और `hook post-write` (`PostToolUse` सत्यापनकर्ता + परियोजना रीफ़्रेश)। |

इसके अलावा तीन अनुष्ठान जो सिस्टम को ईमानदार रखते हैं: **`refresh`** (डिस्पैच इंडेक्स को वैश्विक या `--project <root>` पर पुन: उत्पन्न करें → मान्य करें → प्रकाशित करें, `.bak` क्षतिपूर्ति, ओएस फ़ाइल लॉक और वैकल्पिक `--snapshot-repo` / `--mirror-repo` के साथ), **`doctor`** (केवल-पढ़ने योग्य 8-चेक स्वास्थ्य स्क्रीन), और **`report`** (उपयोग / मृत-प्रविष्टि / टोकन-बजट अवलोकनशीलता)।

## कमांड सतह

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

> **नाम टकराव, नामस्थान द्वारा हल किया गया।** फ्लैट `validate <index>` कर्नेल का इंडेक्स-संरचना सत्यापनकर्ता है। स्टोर और नियम लिंटर को नामस्थान दिया गया है — `memories validate <MEMORY.md>` और `rules validate` — ताकि तीनों सह-अस्तित्व में रह सकें। प्रति-कमांड सारांश, तर्क और निकास कोड के लिए `loadout-os <command> --help` चलाएँ।

## परियोजना-परत मेमोरी और क्लाउड कोड हुक वायरिंग

प्रत्येक परियोजना सीट अपनी मेमोरी स्टोर (`loadout-os refresh --store <store> --project <root>`) से निर्मित अपना `.claude/loadout/index.json` रख सकती है।

### 1. विषय और बोर्ड फ्रंटमैटर

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

- उप-सूचकांक (`index-*.md` या `metadata.loadout_role: subindex` वाली फ़ाइलें) को `subindex: true` के साथ वितरण सूचकांक में एक स्तर तक विस्तारित किया जाता है।
- `index-archive.md` (या `metadata.loadout_default_priority: manual` वाला एक उप-सूचकांक) अपनी प्रविष्टियों को डिफ़ॉल्ट रूप से `priority: "manual"` पर सेट करता है, जब तक कि कोई विषय फ़ाइल स्पष्ट रूप से फ्रंटमैटर में `priority:` सेट न करे।
- `metadata.loadout_inject: session-start` वाली `core` प्रविष्टियों को `SessionStart` पर पूरी तरह से डाला जाता है (और प्रति-प्रॉम्प्ट पॉइंटर स्लॉट से बाहर रखा जाता है ताकि वे कभी भी रूट की गई प्रविष्टियों को बाधित न करें)।
- **प्रविष्टि आईडी स्रोत (`idSource: "title" | "name"`):** एक स्पष्ट फ्रंटमैटर `id:` हमेशा प्रभावी होता है। जब `id:` को छोड़ दिया जाता है, तो वैश्विक / `--dest` डिफ़ॉल्ट रूप से `title` पर सेट हो जाता है (`MEMORY.md` में कीबाब-केस बुलेट शीर्षक, `v1.0.4` प्रविष्टि आईडी को संरक्षित करते हुए), जबकि `--project` डिफ़ॉल्ट रूप से `name` पर सेट हो जाता है (कीबाब-केस फ्रंटमैटर `name:`)। `<store>/.loadout.json` (`{ "idSource": "title" | "name" }`) या `MEMORY.md` फ्रंटमैटर (`metadata.id_source: title | name`) के माध्यम से प्रति स्टोर, या `refresh` और `memories` कमांड पर `--id-source title|name` के माध्यम से प्रति आह्वान करके ओवरराइड करें (जो स्टोर सेटिंग पर प्रभावी होता है)।

### 2. उदाहरण `.claude/settings.local.json` हुक ब्लॉक

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

> **शेल संपादन पर ध्यान दें:** शेल (`Bash` / `PowerShell`) के माध्यम से मेमोरी फ़ाइलों में किए गए संपादन `PostToolUse` (`Write|Edit`) को छोड़ देते हैं। एक अंतर्निहित फ़ॉलबैक के रूप में, `loadout-os hook session-start` जाँचता है कि क्या कोई `<store>/*.md` फ़ाइल परियोजना `index.json` से नई है और स्वचालित रूप से परियोजना इंडेक्स को रीफ़्रेश करता है (या यदि सत्यापन विफल हो जाता है तो चेतावनी देता है)।

## स्थापित करें

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

कर्नेल को एक लाइब्रेरी के रूप में भी आयात किया जा सकता है — `@mcptoolshop/ai-loadout` `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad` और डिस्पैच-टेबल प्रकारों को उजागर करता है।

## प्रलेखन

- **[हैंडबुक](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — अवलोकन, स्थापना, आर्किटेक्चर, कमांड संदर्भ, अनुष्ठान और विरासत पैकेजों से माइग्रेशन।
- **[रिपॉजिटरी](https://github.com/mcp-tool-shop-org/loadout-os)** — स्रोत, रोडमैप और मुद्दे।

## एकत्रित क्यों करें

डीकंपोज-बाय-सीक्रेट्स (पार्नास 1972) एन मनुष्यों की एक टीम के लिए एक स्पष्ट उत्तर था। एक अकेले ऑपरेटर और एलएलएम क्रू के लिए यह परिचालन रूप से टूटा हुआ है: मल्टी-रिपो कार्य एजेंट के संदर्भ को सत्रों में विभाजित करता है, अप्रकाशित एडेप्टर सड़ जाते हैं (केवल कर्नेल ही कभी जारी किया गया), और प्रगति रिपॉजिटरी में क्रमबद्ध होती है। एक नामित छाता रिपॉजिटरी जिसमें एक CLI ऑपरेटर की सेवा करता है।

## स्थिति

शिप किया गया। **`@mcptoolshop/loadout-os`** npm पर प्रकाशित है (सार्वजनिक) और कर्नेल, दो एडेप्टर (मेमोरी + नियम) और लाइव रनटाइम हुक को एक CLI में जोड़ता है — इसे `npm install -g @mcptoolshop/loadout-os` के साथ स्थापित करें। यह तीन विरासत पैकेज जिन्हें यह प्रतिस्थापित करता है, सेवानिवृत्त कर दिए गए हैं: कर्नेल `@mcptoolshop/ai-loadout` npm पर अप्रचलित है (अभी भी स्थापित किया जा सकता है, लेकिन आगे कोई काम नहीं किया जाएगा); `claude-memories` और `claude-rules` स्थानीय-केवल थे और पार्क किए गए हैं। सभी नए कार्य यहां आते हैं।

## विश्वास मॉडल

लोडआउट-ओएस पूरी तरह से आपके मशीन पर चलता है। कोई नेटवर्क कॉल, कोई टेलीमेट्री और कोई खाता नहीं है।

- **यह जिस डेटा को एक्सेस करता है (केवल स्थानीय):** आपकी मेमोरी स्टोरेज (`MEMORY.md` + विषय फ़ाइलें), आपकी निर्देश फ़ाइलें (`CLAUDE.md` + `.claude/rules/`), स्टोरेज के बगल में उत्पन्न डिस्पैच इंडेक्स, वैश्विक रिज़ॉल्वर इंडेक्स (`~/.ai-loadout/index.json`), प्रोजेक्ट रिज़ॉल्वर इंडेक्स (`<project>/.claude/loadout/index.json`), और केवल-जोड़ उपयोग लॉग (`~/.ai-loadout/usage.jsonl`)।
- **यह जिस डेटा को एक्सेस नहीं करता:** कोई नेटवर्क आउटपुट नहीं, कोई टेलीमेट्री नहीं, कोई रिमोट सेवाएं नहीं, कोई क्रेडेंशियल या गुप्त जानकारी नहीं। ऊपर दिए गए स्थानीय डिस्क पथों से कुछ भी नहीं पढ़ा, संग्रहीत या प्रसारित किया जाता है।
- **आवश्यक अनुमतियाँ:** केवल स्थानीय फ़ाइल सिस्टम। `doctor` और `report` केवल पढ़ने के लिए हैं (वे कभी भी नहीं लिखते)। एकमात्र लेखन इंडेक्स फ़ाइलें, इंटरैक्टिव `rules split` आउटपुट और उपयोग लॉग हैं - ये सभी ऊपर दिए गए अपेक्षित स्थानीय स्थानों में हैं। अपरिवर्तनीय लेखन (`refresh` लाइव वैश्विक या प्रोजेक्ट इंडेक्स प्रकाशित करना) को सत्यापन विफलता पर एक एंडोन हॉल्ट द्वारा सुरक्षित किया जाता है और एक `<dest>.bak` क्षतिपूर्तिकर्ता द्वारा। प्रॉम्प्ट और सत्र-प्रारंभ रनटाइम हुक विफल-खुले हैं: प्रत्येक त्रुटि पथ `0` से बाहर निकलता है, इसलिए वे कभी भी प्रॉम्प्ट को अवरुद्ध नहीं कर सकते।

पूर्ण खतरे का मॉडल और रिपोर्टिंग प्रक्रिया: [SECURITY.md](./SECURITY.md)।

## लाइसेंस

एमआईटी - यह सभी अपस्ट्रीम स्रोतों से मेल खाता है।

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
