import type { Dictionary } from './en';

/**
 * Hindi dictionary.
 *
 * Written for the reader in the PRD (Meena, 24: conversational English is fine, legal English is
 * not), so the target is the Hindi a person actually speaks, not the Sanskritised register of
 * official letters. Where an everyday word and a formal one both exist, the everyday one wins:
 * a reader who has to decode the translation is no better off than one reading the contract.
 *
 * Words the audience already uses in English stay in English or in Devanagari transliteration —
 * CTC, PF, HR, PDF, ऑफर लेटर, नोटिस पीरियड, प्रोबेशन. These appear that way on their own documents
 * and in their own conversations, so "translating" them would add a decoding step, not remove one.
 *
 * Two things are deliberately *not* softened in translation: the disclaimer strings and the risk
 * labels. Hindi has a polite register that would quietly turn "this is not legal advice" into
 * "this is only for information"; the wording below keeps the same weight as the English, and no
 * string here tells the reader to sign or not to sign.
 *
 * `app.name` and the two `lang.*` names are intentionally identical to English: a language
 * switcher that labels a language in a script you cannot read is useless, and the product name is
 * a brand. The typed annotation below is what makes a missing key a compile error.
 */
export const hi: Dictionary = {
  /* ---------------------------------- app shell --------------------------------- */
  'app.name': 'SignSure',
  'app.tagline': 'साइन करने से पहले हर क्लॉज़ को समझें।',
  'app.skipToContent': 'सीधे मुख्य कंटेंट पर जाएँ',
  'app.disclaimerShort': 'SignSure आपका डॉक्यूमेंट समझाता है। यह कानूनी सलाह नहीं है।',
  'app.disclaimerLink': 'पूरा डिस्क्लेमर पढ़ें',
  'app.howItWorks': 'SignSure कैसे काम करता है',
  'app.privacy': 'प्राइवेसी',
  'app.footerNote':
    'SignSure सीखने-समझने का टूल है। इससे वकील और क्लाइंट का रिश्ता नहीं बनता, और इसका नतीजा अधूरा या गलत भी हो सकता है। कानून हर राज्य में अलग होते हैं और समय के साथ बदलते भी हैं। यहाँ दी गई किसी भी बात पर भरोसा करने से पहले किसी योग्य वकील से सलाह ज़रूर लें।',
  'app.startOver': 'सब कुछ हटाएँ',
  'app.startOverHint': 'आपका डॉक्यूमेंट और यह रिपोर्ट इस ब्राउज़र से हटा दी जाएगी।',

  'lang.label': 'भाषा',
  'lang.en': 'English',
  'lang.hi': 'हिन्दी (Hindi)',
  'readingLevel.label': 'पढ़ने का स्तर',
  'readingLevel.simple': 'आसान',
  'readingLevel.standard': 'सामान्य',

  /* ------------------------------------ home ------------------------------------ */
  'home.heading': 'साइन करने से पहले हर क्लॉज़ को समझें।',
  'home.intro':
    'SignSure भारतीय ऑफर लेटर या एम्प्लॉयमेंट एग्रीमेंट को पढ़कर एक-एक क्लॉज़ का मतलब बताता है, और हर जवाब के पीछे का असली टेक्स्ट भी दिखाता है।',
  'home.trust1Title': 'सोर्स भी दिखाता है',
  'home.trust1Body': 'हर जवाब उसी क्लॉज़ के बगल में दिखता है जिससे वह निकला है, पेज नंबर के साथ।',
  'home.trust2Title': 'जो नहीं पता, वह साफ़ कह देता है',
  'home.trust2Body':
    'अगर आपके डॉक्यूमेंट में किसी बात का ज़िक्र ही नहीं है, तो SignSure यह बता देता है और यह भी बताता है कि उसकी जगह क्या पूछना चाहिए।',
  'home.trust3Title': 'आपका डॉक्यूमेंट आपके ही डिवाइस पर रहता है',
  'home.trust3Body':
    'फ़ाइल आपके ब्राउज़र के अंदर ही पढ़ी जाती है। जाँच के लिए सिर्फ़ क्लॉज़ का टेक्स्ट भेजा जाता है, और कुछ भी सेव नहीं होता।',
  'home.cta': 'मेरा ऑफर लेटर जाँचें',
  'home.sampleCta': 'सैंपल से आज़माकर देखें',

  /* ----------------------------------- upload ----------------------------------- */
  'upload.heading': 'अपना डॉक्यूमेंट जोड़ें',
  'upload.tabFile': 'फ़ाइल अपलोड करें',
  'upload.tabPaste': 'टेक्स्ट पेस्ट करें',
  'upload.dropzoneHint': 'PDF, Word (.docx) या सादा टेक्स्ट, 10 MB तक।',
  'upload.chooseFile': 'फ़ाइल चुनें',
  'upload.dropHere': 'अपनी फ़ाइल यहाँ छोड़ें',
  'upload.pasteLabel': 'अपना ऑफर लेटर यहाँ पेस्ट करें',
  'upload.pasteHint': 'पूरा लेटर कॉपी करें, क्लॉज़ नंबर भी छोड़े बिना।',
  'upload.pasteAction': 'यह टेक्स्ट पढ़ें',
  'upload.sampleAction': 'सैंपल ऑफर लेटर से आज़माएँ',
  'upload.sampleNote':
    'यह एक बनावटी लेटर है, ताकि कुछ भी अपलोड किए बिना आप देख सकें कि SignSure कैसे काम करता है।',
  'upload.reading': 'आपका डॉक्यूमेंट पढ़ा जा रहा है…',
  'upload.parsedPages': 'हमें {pages} पेजों में {clauses} क्लॉज़ मिले।',
  'upload.parsedNoPages': 'हमें {clauses} क्लॉज़ मिले।',
  'upload.parsedPreview': 'शुरुआत के कुछ क्लॉज़',
  'upload.continue': 'चुनें कि किस बात पर ध्यान देना है',
  'upload.useDifferent': 'कोई दूसरा डॉक्यूमेंट इस्तेमाल करें',
  'upload.truncated':
    'यह डॉक्यूमेंट {pages} पेज से लंबा है। SignSure ने सिर्फ़ पहले {pages} पेज ही पढ़े हैं।',

  /* ------------------------------- upload errors -------------------------------- */
  'upload.error.TOO_LARGE':
    'यह फ़ाइल {sizeMb} MB की है। कृपया {limitMb} MB से छोटी फ़ाइल अपलोड करें, या उसका टेक्स्ट पेस्ट कर दें।',
  'upload.error.EMPTY': 'वह फ़ाइल खाली है। कृपया कोई दूसरी फ़ाइल चुनें।',
  'upload.error.UNSUPPORTED_TYPE':
    'SignSure PDF, Word (.docx) और सादा टेक्स्ट फ़ाइलें पढ़ सकता है। यह फ़ाइल {extension} है।',
  'upload.error.CONTENT_MISMATCH':
    'नाम से तो यह {claimed} फ़ाइल लगती है, पर अंदर से ऐसी नहीं दिखती। कृपया फ़ाइल देख लें और दोबारा कोशिश करें।',
  'upload.error.SCANNED_PDF':
    'यह PDF टेक्स्ट नहीं, स्कैन की हुई तस्वीरें लगती है, इसलिए SignSure के पढ़ने लायक इसमें कुछ नहीं है। कंपनी से टेक्स्ट वाली PDF माँगकर देखें, या टेक्स्ट खुद पेस्ट कर दें।',
  'upload.error.NO_TEXT': 'SignSure को उस डॉक्यूमेंट में पढ़ने लायक कोई टेक्स्ट नहीं मिला।',
  'upload.error.TOO_MUCH_TEXT':
    'इस डॉक्यूमेंट में {chars} अक्षर हैं, जो {limit} अक्षरों की सीमा से ज़्यादा है। सिर्फ़ एम्प्लॉयमेंट एग्रीमेंट अलग से भेजकर देखें।',
  'upload.error.ENCRYPTED': 'यह PDF पासवर्ड से बंद है। कृपया पासवर्ड हटाकर दोबारा कोशिश करें।',
  'upload.error.CORRUPT': 'यह PDF पढ़ी नहीं जा सकी। हो सकता है यह खराब हो गई हो।',
  'upload.error.UNKNOWN': 'उस डॉक्यूमेंट को पढ़ने में कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',

  /* ------------------------------------ lenses ---------------------------------- */
  'lenses.heading': 'आपको सबसे ज़्यादा चिंता किस बात की है?',
  'lenses.intro':
    'जितने चाहें उतने चुनें। इससे रिपोर्ट का क्रम बदलता है, यह नहीं कि उसमें क्या मिलता है: गंभीर क्लॉज़ हर हाल में दिखेगा, आप चाहे कुछ भी चुनें।',
  'lenses.QUIT_EARLY': 'हो सकता है मैं जल्दी नौकरी छोड़ दूँ',
  'lenses.QUIT_EARLY.hint': 'नोटिस पीरियड, बॉन्ड, नौकरी छोड़ने पर क्या भरना पड़ेगा',
  'lenses.FUTURE_JOBS': 'मेरी अगली नौकरी',
  'lenses.FUTURE_JOBS.hint': 'नॉन-कंपीट, नॉन-सॉलिसिट, गोपनीयता',
  'lenses.SALARY': 'मेरी सैलरी',
  'lenses.SALARY.hint': 'CTC ब्रेकअप, वेरिएबल पे, कटौतियाँ, क्लॉबैक',
  'lenses.GETTING_FIRED': 'नौकरी से निकाला जाना',
  'lenses.GETTING_FIRED.hint': 'टर्मिनेशन, प्रोबेशन, कंपनी की तरफ़ से नोटिस',
  'lenses.EVERYTHING': 'मुझे सब कुछ दिखाएँ',
  'lenses.EVERYTHING.hint': 'कोई खास फ़ोकस नहीं',
  'lenses.analyse': 'मेरा डॉक्यूमेंट जाँचें',
  'lenses.back': 'पीछे जाएँ',

  /* ------------------------------------ report ---------------------------------- */
  'report.heading': 'आपकी रिपोर्ट',
  'report.forDocument': '{name} के लिए',
  'report.tab.overview': 'सारांश',
  'report.tab.clauses': 'क्लॉज़',
  'report.tab.ask': 'सवाल पूछें',
  'report.tab.compare': 'तुलना',
  'report.tab.prepare': 'तैयारी',
  'report.tabsLabel': 'रिपोर्ट के हिस्से',

  'report.loading': 'आपके क्लॉज़ पढ़े जा रहे हैं और हर कोट जाँचा जा रहा है…',
  'report.loadingStage1': 'आपके क्लॉज़ पढ़े जा रहे हैं…',
  'report.loadingStage2': 'हर कोट को आपके डॉक्यूमेंट से मिलाकर देखा जा रहा है…',
  'report.loadingStage3': 'भारत की रूल लाइब्रेरी लगाई जा रही है…',
  'report.retry': 'दोबारा कोशिश करें',

  'report.verifiedCount':
    '{total} में से {verified} जवाबों के पीछे ऐसा कोट है जिसे हमने आपके डॉक्यूमेंट से मिलाकर जाँचा है।',
  'report.partial':
    'इस डॉक्यूमेंट का कुछ हिस्सा जाँचा नहीं जा सका, इसलिए इस रिपोर्ट में कुछ क्लॉज़ छूट सकते हैं। फिर से कोशिश करें, या पूरा डॉक्यूमेंट ख़ुद भी पढ़ें।',
  'report.unverifiedNote':
    '{count} को जाँचा नहीं जा सका। उन्हें अलग से दिखाया गया है और रेड फ्लैग में नहीं गिना गया है।',

  /* ----------------------------------- overview --------------------------------- */
  'overview.summaryHeading': 'एक नज़र में',
  'overview.notStated': 'लिखा नहीं है',
  'overview.documentType': 'डॉक्यूमेंट किस तरह का है',
  'overview.employer': 'कंपनी',
  'overview.role': 'पद',
  'overview.startDate': 'जॉइनिंग की तारीख',
  'overview.noticePeriod': 'नोटिस पीरियड',
  'overview.probation': 'प्रोबेशन',
  'overview.bondOrPenalty': 'बॉन्ड या छोड़ने पर जुर्माना',
  'overview.redFlagsHeading': 'ध्यान से देखने लायक',
  'overview.noRedFlags':
    'SignSure को इस डॉक्यूमेंट में ज़्यादा जोखिम वाला कोई क्लॉज़ नहीं मिला। इसका मतलब यह नहीं कि डॉक्यूमेंट में सब ठीक ही है, इसलिए इसे पूरा पढ़ना ज़रूरी है।',
  'overview.rulesHeading': 'भारत के हिसाब से कानूनी जानकारी',
  'overview.missingHeading': 'इस डॉक्यूमेंट में क्या नहीं लिखा है',
  'overview.missingIntro':
    'ये वे बातें हैं जो ऑफर लेटर में आमतौर पर होती हैं। आपके लेटर में नहीं हैं, इसलिए इनके बारे में पूछ लेना ठीक रहेगा।',
  'overview.unverifiedHeading': 'इन्हें हम जाँच नहीं सके',
  'overview.unverifiedIntro':
    'नीचे दिए गए जवाबों से मेल खाता कोट SignSure को आपके डॉक्यूमेंट में नहीं मिला, इसलिए इन्हें अलग दिखाया गया है और इन पर भरोसा नहीं करना चाहिए।',

  /* ------------------------------------ clauses --------------------------------- */
  'clauses.heading': 'हर क्लॉज़',
  'clauses.filterCategory': 'कैटेगरी',
  'clauses.filterRisk': 'जोखिम का स्तर',
  'clauses.filterAll': 'सभी',
  'clauses.search': 'क्लॉज़ में खोजें',
  'clauses.searchHint': 'खोज आपके डॉक्यूमेंट के असली टेक्स्ट में होती है।',
  'clauses.none': 'इन फ़िल्टर से कोई क्लॉज़ मेल नहीं खाता।',
  'clauses.count': '{total} में से {shown} क्लॉज़ दिखाए जा रहे हैं।',
  'clauses.viewOriginal': 'असली टेक्स्ट देखें',
  'clauses.hideOriginal': 'असली टेक्स्ट छिपाएँ',
  'clauses.explanation': 'आसान भाषा में मतलब',
  'clauses.originalText': 'असली टेक्स्ट',
  'clauses.clauseLabel': 'क्लॉज़ {label}',
  'clauses.page': 'पेज {page}',
  'clauses.pageRange': 'पेज {page} से {pageEnd} तक',
  'clauses.paragraph': 'पैराग्राफ़ {order}',
  'clauses.whyItMatters': 'यह क्यों मायने रखता है',
  'clauses.questionsToAsk': 'आप ये सवाल पूछ सकते हैं',

  /* -------------------------------------- risk ---------------------------------- */
  'risk.high': 'ज़्यादा जोखिम',
  'risk.medium': 'जाँच लेने लायक',
  'risk.low': 'आम तौर पर ऐसा ही होता है',
  'risk.info': 'जानकारी के लिए',

  'verify.verified': 'जाँचा हुआ कोट',
  'verify.verifiedHint': 'यही टेक्स्ट हूबहू आपके डॉक्यूमेंट में मिला है।',
  'verify.fuzzy': 'लगभग मिलता-जुलता',
  'verify.fuzzyHint': 'आपके डॉक्यूमेंट में लगभग यही टेक्स्ट मिला है।',
  'verify.unverified': 'जाँच नहीं हो सकी',
  'verify.unverifiedHint': 'यह टेक्स्ट हमें आपके डॉक्यूमेंट में नहीं मिला।',

  /* ------------------------------------ rule card -------------------------------- */
  'rule.basis': 'किस आधार पर',
  'rule.lastReviewed': 'आख़िरी बार {date} को देखा गया',
  'rule.generalInfo': 'यह आम जानकारी है, आपके मामले के बारे में सलाह नहीं।',
  'rule.questions': 'ये सवाल पूछें',

  /* --------------------------------------- ask ----------------------------------- */
  'ask.heading': 'अपने डॉक्यूमेंट के बारे में पूछें',
  'ask.intro':
    'SignSure सिर्फ़ उसी डॉक्यूमेंट से जवाब देता है जो आपने दिया है। अगर आपके डॉक्यूमेंट में कोई बात नहीं है, तो वह साफ़ कह देगा।',
  'ask.label': 'आपका सवाल',
  'ask.placeholder': 'जैसे: एक साल बाद नौकरी छोड़ दूँ तो क्या होगा?',
  'ask.send': 'पूछें',
  'ask.sending': 'आपके डॉक्यूमेंट में ढूँढा जा रहा है…',
  'ask.suggested': 'दूसरे लोग ये सवाल पूछते हैं',
  'ask.answeredStatus': 'आपके डॉक्यूमेंट से मिला जवाब',
  'ask.notInDocumentStatus': 'आपके डॉक्यूमेंट में यह नहीं लिखा है',
  'ask.needsProfessionalStatus': 'यह वकील से पूछ लेना बेहतर होगा',
  'ask.citations': 'यह कहाँ से आया है',
  'ask.citationButton': 'क्लॉज़ {label} पर जाएँ',
  'ask.missingInfo': 'क्या-क्या छूट रहा है',
  'ask.suggestedNext': 'आप यह भी पूछ सकते हैं',
  'ask.empty': 'अभी कोई सवाल नहीं है। नीचे दिए सुझावों में से कोई आज़माकर देखें।',
  'ask.tooLong': 'कृपया अपना सवाल {limit} अक्षरों के अंदर रखें।',
  'ask.answerRegion': 'जवाब',

  'ask.q.noticePeriod': 'मेरा नोटिस पीरियड कितना है?',
  'ask.q.bondCost': 'पहले साल में नौकरी छोड़ दूँ तो मुझे कितना भरना पड़ेगा?',
  'ask.q.noticeBuyout': 'क्या नोटिस पीरियड का पैसा देकर जल्दी निकला जा सकता है?',
  'ask.q.joinCompetitor': 'क्या वे मुझे किसी कॉम्पिटिटर कंपनी में जाने से रोक सकते हैं?',
  'ask.q.sideProjects': 'क्या मुझे अपने साइड प्रोजेक्ट पर काम करने की छूट है?',
  'ask.q.confidentialAfter': 'नौकरी छोड़ने के बाद मुझे क्या-क्या गोपनीय रखना होगा?',
  'ask.q.inHandSalary': 'हर महीने मेरी इन-हैंड सैलरी कितनी बनेगी?',
  'ask.q.variablePay': 'मेरी सैलरी का कौन-सा हिस्सा वेरिएबल है?',
  'ask.q.deductions': 'मेरी सैलरी से क्या-क्या काटा जा सकता है?',
  'ask.q.terminationNotice': 'कंपनी को मुझे कितने दिन का नोटिस देना होगा?',
  'ask.q.probationRules': 'प्रोबेशन के दौरान क्या होता है?',
  'ask.q.disputeForum': 'कोई विवाद हुआ तो फैसला कहाँ होगा?',
  'ask.q.biggestRisk': 'इस डॉक्यूमेंट का सबसे जोखिम भरा क्लॉज़ कौन-सा है?',
  'ask.q.missingInfo': 'यह डॉक्यूमेंट मुझे क्या नहीं बताता?',
  'ask.q.negotiate': 'किन बातों पर मैं मोलभाव करके देख सकता हूँ?',

  /* ------------------------------------- compare --------------------------------- */
  'compare.heading': 'दो वर्ज़न की तुलना करें',
  'compare.intro':
    'बदला हुआ ऑफर जोड़ दें, SignSure बता देगा कि क्या-क्या बदला है। आपका पहला डॉक्यूमेंट वैसे का वैसा रहेगा।',
  'compare.addSecond': 'बदला हुआ डॉक्यूमेंट जोड़ें',
  'compare.run': 'दोनों वर्ज़न की तुलना करें',
  'compare.running': 'दोनों वर्ज़न की तुलना की जा रही है…',
  'compare.noChanges': 'इन दोनों वर्ज़न के बीच मतलब का कोई बदलाव नहीं मिला।',
  'compare.unchanged': '{count} क्लॉज़ में कोई बदलाव नहीं है।',
  'compare.changeType.ADDED': 'जोड़ा गया',
  'compare.changeType.REMOVED': 'हटाया गया',
  'compare.changeType.CHANGED': 'बदला गया',
  'compare.impact.BETTER_FOR_EMPLOYEE': 'आपके लिए बेहतर',
  'compare.impact.WORSE_FOR_EMPLOYEE': 'आपके लिए खराब',
  'compare.impact.NEUTRAL': 'कोई खास फ़र्क नहीं',
  'compare.impact.UNCLEAR': 'साफ़ नहीं है',
  'compare.changeColumn': 'बदलाव',
  'compare.versionA': 'पहला वर्ज़न',
  'compare.versionB': 'बदला हुआ वर्ज़न',
  'compare.tableLabel': 'दोनों वर्ज़न के बीच के बदलाव',

  /* ------------------------------------- prepare --------------------------------- */
  'prepare.heading': 'बातचीत की तैयारी करें',
  'prepare.intro':
    'यह वह शीट है जिसे आप HR या वकील के पास ले जा सकते हैं। जिन सवालों पर जाँचा हुआ लिखा है, वे हमारी भारत रूल लाइब्रेरी से आते हैं, AI से नहीं।',
  'prepare.build': 'मेरी तैयारी शीट बनाएँ',
  'prepare.building': 'आपकी शीट तैयार की जा रही है…',
  'prepare.checklist': 'साइन करने से पहले',
  'prepare.questionsForHR': 'HR से पूछने वाले सवाल',
  'prepare.questionsForLawyer': 'वकील से पूछने वाले सवाल',
  'prepare.missingInformation': 'जो जानकारी अब भी चाहिए',
  'prepare.documentsToBring': 'साथ ले जाने वाले डॉक्यूमेंट',
  'prepare.print': 'प्रिंट करें',
  'prepare.copy': 'कॉपी करें',
  'prepare.copied': 'आपके क्लिपबोर्ड पर कॉपी हो गया।',
  'prepare.copyFailed': 'अपने-आप कॉपी नहीं हो सका। कृपया डाउनलोड या प्रिंट का इस्तेमाल करें।',
  'prepare.exportTitle': 'अपने ऑफर पर बात करने की तैयारी',
  'prepare.exportDocument': 'डॉक्यूमेंट: {name}',
  'prepare.exportFlagged': 'ध्यान से देखने लायक क्लॉज़',
  'prepare.exportFooter':
    'SignSure से तैयार किया गया। यह जानकारी है, कानूनी सलाह नहीं। कोई भी ज़रूरी बात किसी योग्य वकील से ज़रूर पक्की करें।',
  'highlight.end': 'हाइलाइट ख़त्म',
  'report.highRiskCount': '{count} ज़्यादा जोखिम वाले',
  'prepare.download': '.md फ़ाइल के रूप में डाउनलोड करें',
  'prepare.checkboxHint': 'टिक लगाना सिर्फ़ आपके अपने लिए है। कुछ भी सेव नहीं होता।',

  /* -------------------------------------- errors --------------------------------- */
  'error.INVALID_INPUT': 'उस रिक्वेस्ट में कुछ ठीक नहीं था। कृपया दोबारा कोशिश करें।',
  'error.UNAUTHORIZED': 'आपका सेशन खत्म हो गया है। आगे बढ़ने के लिए कृपया पेज दोबारा लोड करें।',
  'error.TOO_LARGE': 'वह डॉक्यूमेंट जाँच के लिए बहुत बड़ा है। कोई छोटा डॉक्यूमेंट आज़माकर देखें।',
  'error.RATE_LIMITED':
    'आपने बहुत सारी रिक्वेस्ट भेज दी हैं। कृपया एक मिनट रुककर दोबारा कोशिश करें।',
  'error.MODEL_BLOCKED':
    'असिस्टेंट इस डॉक्यूमेंट को पढ़ नहीं सका। अगर इसमें कुछ अलग तरह का कंटेंट है, तो सिर्फ़ एम्प्लॉयमेंट एग्रीमेंट अलग से आज़माकर देखें।',
  'error.MODEL_INVALID_OUTPUT':
    'असिस्टेंट ने ऐसा जवाब लौटाया जो काम का नहीं है। कृपया दोबारा कोशिश करें।',
  'error.UPSTREAM_TIMEOUT': 'इसमें बहुत ज़्यादा समय लग गया। कृपया दोबारा कोशिश करें।',
  'error.INTERNAL': 'हमारी तरफ़ से कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',
  'error.heading': 'यह नहीं हो पाया',
  'error.offline': 'लगता है आप ऑफ़लाइन हैं। कृपया अपना कनेक्शन देखकर दोबारा कोशिश करें।',

  /* ------------------------------------ a11y tools ------------------------------- */
  'readAloud.play': 'पढ़कर सुनाएँ',
  'readAloud.stop': 'पढ़ना रोकें',
  'readAloud.unsupported': 'आपका ब्राउज़र टेक्स्ट पढ़कर नहीं सुना सकता।',
  'glossary.open': '{term} का क्या मतलब है?',
  'glossary.close': 'बंद करें',
  'glossary.liquidatedDamages.definition':
    'वह रकम जो कॉन्ट्रैक्ट के अनुसार आपको कोई शर्त तोड़ने पर देनी होगी, जैसे जल्दी नौकरी छोड़ना। भारत में कोर्ट आम तौर पर पूरी रकम नहीं, सिर्फ़ उचित रकम दिलवाते हैं।',
  'glossary.arbitration.definition':
    'कोर्ट के बाहर विवाद सुलझाने का निजी तरीका, जिसमें जज की जगह आर्बिट्रेटर फ़ैसला करता है। यह महँगा हो सकता है, और कॉन्ट्रैक्ट में लिखा हो सकता है कि आर्बिट्रेटर कौन चुनेगा।',
  'glossary.noticePeriod.definition':
    'नौकरी ख़त्म करने की सूचना देने और आख़िरी कामकाजी दिन के बीच आपको या कंपनी को कितना इंतज़ार करना होगा।',
  'glossary.ctc.definition':
    'कॉस्ट टू कंपनी: साल भर में कंपनी आप पर जो कुल ख़र्च करती है, योगदान और सुविधाओं समेत। आपकी महीने की इन-हैंड सैलरी CTC को बारह से भाग देने पर मिलने वाली रकम से कम होती है।',
  'glossary.indemnity.definition':
    'किसी और के नुक़सान की भरपाई करने का वादा। अगर आप कंपनी को इंडेम्निफ़ाई करते हैं, तो आपकी किसी गलती से कंपनी को हुए नुक़सान का भुगतान आपको करना पड़ सकता है।',
  'glossary.probation.definition':
    'नौकरी की शुरुआत में ट्रायल का समय, जिसमें अक्सर नोटिस कम और सुविधाएँ कम होती हैं। लिखित कन्फ़र्मेशन मिलने पर यह ख़त्म होता है।',
  'glossary.nonCompete.definition':
    'ऐसी शर्त जो आपको किसी प्रतिस्पर्धी कंपनी में काम करने या अपना ऐसा बिज़नेस शुरू करने से रोकने की कोशिश करती है। भारत में नौकरी छोड़ने के बाद लागू होने वाली पाबंदियों को आम तौर पर नौकरी के दौरान की पाबंदियों से बहुत अलग तरह से देखा जाता है।',
  'glossary.gratuity.definition':
    'एक तय अवधि तक काम करने के बाद नौकरी छोड़ने पर मिलने वाली एकमुश्त रकम, जो कानून तय करता है, कंपनी नहीं।',
  'glossary.providentFund.definition':
    'PF: रिटायरमेंट के लिए बचत योजना। हर महीने आपकी सैलरी का एक हिस्सा इसमें जाता है, और कंपनी भी उतना ही योगदान देती है।',
  'glossary.jurisdiction.definition':
    'इस कॉन्ट्रैक्ट से जुड़ा कोई विवाद किस शहर की किन अदालतों में सुना जाएगा।',

  /* -------------------------------------- turnstile ------------------------------ */
  'turnstile.label': 'सुरक्षा जाँच',
  'turnstile.hint':
    'यह झटपट होने वाली अपने आप की जाँच है कि आप इंसान हैं। आमतौर पर कुछ करना नहीं पड़ता।',
  'turnstile.failed': 'सुरक्षा जाँच पूरी नहीं हो पाई। कृपया पेज दोबारा लोड करें।',
  'turnstile.waiting': 'झटपट सुरक्षा जाँच चल रही है…',
};
