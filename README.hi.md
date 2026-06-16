<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**एआई कोडिंग एजेंटों के लिए एक नॉलेज ओएस।** एक सीएलआई जो आवश्यकतानुसार मॉडल में सही संदर्भ भेजता है - प्रत्येक सत्र की शुरुआत में हर मेमोरी फ़ाइल और नियम को संदर्भ विंडो में डालने के बजाय।

आपकी निर्देशिका फाइलें और मेमोरी स्टोर असीमित रूप से बढ़ती हैं। प्रत्येक पंक्ति प्रत्येक प्रॉम्प्ट पर टोकन खर्च करती है, चाहे वह वर्तमान कार्य के लिए प्रासंगिक हो या नहीं। लोडआउट-ओएस हमेशा एक छोटी डिस्पैच इंडेक्स लोड रखता है और केवल तभी भारी डेटा - मेमोरी विषय, नियम फ़ाइलें - लोड करता है जब कार्य कीवर्ड मेल खाते हैं। इसे गेम लोडआउट की तरह समझें: एजेंट को ठीक उसी ज्ञान से लैस करें जिसकी उसे आगामी मिशन के लिए आवश्यकता है।

## इसके अंदर क्या है

लोडआउट-ओएस एक `loadout-os` बाइनरी के तहत चार सतहों को एकीकृत करता है:

| सतह | यह क्या करता है |
|---|---|
| **Kernel** (knowledge router) | निर्धारित कीवर्ड/पैटर्न मिलानकर्ता, पदानुक्रमित लेयर्ड रिज़ॉल्वर (वैश्विक → संगठन → परियोजना → सत्र), और एजेंट रनटाइम अनुबंध। मुख्य प्रविष्टियाँ हमेशा लोड होती हैं; डोमेन प्रविष्टियाँ मेल खाने पर लोड होती हैं; मैन्युअल प्रविष्टियाँ स्पष्ट लुकअप पर लोड होती हैं। |
| **Memories adapter** | एक `MEMORY.md` स्टोर को मशीन-पठनीय डिस्पैच तालिका में बदलता है और इसे जांचता है (गायब फाइलें, अनाथ, डुप्लिकेट, बहुत लंबी प्रविष्टियाँ)। |
| **Rules adapter** | एक अतिरंजित `CLAUDE.md` को एक दुबली, हमेशा लोड होने वाली इंडेक्स प्लस ऑन-डिमांड नियम फ़ाइलों में विभाजित करता है, और फ्रंटमैटर को इंडेक्स के विरुद्ध मान्य करता है। |
| **Runtime hook** | एक `UserPromptSubmit` हुक जो आपके प्रॉम्प्ट से संबंधित प्रविष्टियों में ≤5 पॉइंटर लाइनें (≤200 टोकन) इंजेक्ट करता है। विफल-सुरक्षित: प्रत्येक त्रुटि पथ 0 पर समाप्त होता है, इसलिए एक टूटी हुई हुक कभी भी किसी प्रॉम्प्ट को अवरुद्ध नहीं कर सकती है। |

प्लस तीन अनुष्ठान जो सिस्टम को ईमानदार रखते हैं: **`refresh`** (पुनर्जीवित करें → मान्य करें → डिस्पैच इंडेक्स प्रकाशित करें, एक बैकअप क्षतिपूर्ति के साथ), **`doctor`** (केवल-पढ़ने योग्य 8-चेक स्वास्थ्य स्क्रीन), और **`report`** (उपयोग / मृत-प्रविष्टि / टोकन-बजट अवलोकन)।

## कमांड सतह

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

> **नाम टकराव, नामस्थान द्वारा हल किया गया।** फ्लैट `validate <index>` कर्नेल का इंडेक्स-संरचना सत्यापनकर्ता है। स्टोर और नियम लिंटर को नामस्थान दिया गया है - `memories validate <MEMORY.md>` और `rules validate` - ताकि तीनों सह-अस्तित्व में रहें। प्रति-कमांड सारांश, तर्क और निकास कोड के लिए `loadout-os <command> --help` चलाएं।

## स्थापित करें

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

कर्नेल को एक लाइब्रेरी के रूप में भी आयात किया जा सकता है - `@mcptoolshop/ai-loadout` `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad`, और डिस्पैच-टेबल प्रकारों को उजागर करता है।

## प्रलेखन

- **[हैंडबुक](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** - अवलोकन, स्थापना, आर्किटेक्चर, कमांड संदर्भ, अनुष्ठान और पुराने पैकेजों से माइग्रेशन।
- **[रिपॉजिटरी](https://github.com/mcp-tool-shop-org/loadout-os)** - स्रोत, रोडमैप और मुद्दे।

## एकीकृत क्यों करें

सीक्रेट्स द्वारा विघटन (पारनास 1972) एन मनुष्यों की एक टीम के लिए एक स्पष्ट उत्तर था। अकेले ऑपरेटर प्लस एलएलएम क्रू के लिए यह परिचालन रूप से टूटा हुआ है: मल्टी-रिपो कार्य एजेंट के संदर्भ को सत्रों में विभाजित करता है, अप्रकाशित एडेप्टर सड़ जाते हैं (केवल कर्नेल ही कभी जारी किया गया), और प्रगति रिपॉजिटरी में क्रमबद्ध होती है। एक नामित छाता रिपॉजिटरी जिसमें एक सीएलआई ऑपरेटर की सेवा करती है। पूर्ण तर्क कैनोनिकल मेमोरी स्टोर (`feedback_consolidate_when_cant_juggle_repos.md`) में रहता है।

## स्थिति

जारी किया गया। **`@mcptoolshop/loadout-os`** npm (सार्वजनिक) पर प्रकाशित किया गया है और कर्नेल, दो एडेप्टर (मेमोरी + नियम), और लाइव रनटाइम हुक को एक सीएलआई में जोड़ता है - इसे `npm install -g @mcptoolshop/loadout-os` के साथ स्थापित करें। यह तीन पुराने पैकेज जिन्हें इसने प्रतिस्थापित किया है, अब उपयोग में नहीं हैं: कर्नेल `@mcptoolshop/ai-loadout` npm पर अप्रचलित है (अभी भी स्थापित करने योग्य, लेकिन आगे कोई काम नहीं होगा); `claude-memories` और `claude-rules` केवल स्थानीय थे और पार्क किए गए हैं। सभी नए कार्य यहां आते हैं।

## विश्वास मॉडल

लोडआउट-ओएस पूरी तरह से आपके मशीन पर चलता है। कोई नेटवर्क कॉल, कोई टेलीमेट्री और कोई खाता नहीं है।

- **यह जिन डेटा को छूता है (केवल स्थानीय):** आपका मेमोरी स्टोर (`MEMORY.md` + विषय फाइलें), आपकी निर्देशिका फाइलें (`CLAUDE.md` + `.claude/rules/`), उत्पन्न डिस्पैच इंडेक्स स्टोर के बगल में, वैश्विक रिज़ॉल्वर इंडेक्स (`~/.ai-loadout/index.json`), और केवल-जोड़ने वाली उपयोग लॉग (`~/.ai-loadout/usage.jsonl`)।
- **यह जिस डेटा को नहीं छूता है:** कोई नेटवर्क आउटपुट नहीं, कोई टेलीमेट्री नहीं, कोई रिमोट सेवाएं नहीं, कोई क्रेडेंशियल या गुप्त जानकारी नहीं। स्थानीय डिस्क पथों से ऊपर कुछ भी नहीं पढ़ा, संग्रहीत या प्रसारित किया जाता है।
- **आवश्यक अनुमतियाँ:** केवल स्थानीय फ़ाइल सिस्टम। `doctor` और `report` पूरी तरह से रीड हैं (वे कभी भी नहीं लिखते)। एकमात्र लेखन इंडेक्स फाइलें, इंटरैक्टिव `rules split` आउटपुट और उपयोग लॉग हैं - सभी ऊपर अपेक्षित स्थानीय स्थानों में। अपरिवर्तनीय लेखन (`refresh` लाइव वैश्विक इंडेक्स प्रकाशित करना) सत्यापन विफलता पर एक एंडोन हॉल्ट द्वारा संरक्षित है और `<dest>.bak` क्षतिपूर्तिकर्ता द्वारा। रनटाइम हुक विफल-सुरक्षित है: प्रत्येक त्रुटि पथ 0 पर समाप्त होता है, इसलिए यह कभी भी किसी प्रॉम्प्ट को अवरुद्ध नहीं कर सकता है।

पूर्ण खतरे का मॉडल और रिपोर्टिंग प्रक्रिया: [SECURITY.md](./SECURITY.md)।

## लाइसेंस

एमआईटी - सभी अपस्ट्रीम स्रोतों से मेल खाता है।
