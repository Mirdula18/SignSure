/**
 * English source dictionary.
 *
 * Every other language is typed against this object, so a missing key is a compile error rather
 * than a silently untranslated string. Keys are grouped by screen; `{placeholders}` are
 * substituted by `translate()`.
 *
 * House style for the text itself: second person, short sentences, no legal jargon without an
 * explanation beside it, and never an instruction about whether to sign.
 */
export const en = {
  /* ---------------------------------- app shell --------------------------------- */
  'app.name': 'SignSure',
  'app.tagline': 'Understand every clause before you sign.',
  'app.skipToContent': 'Skip to main content',
  'app.disclaimerShort': 'SignSure explains your document. It is not legal advice.',
  'app.disclaimerLink': 'Read the full disclaimer',
  'app.privacy': 'Privacy',
  'app.privacyNote':
    "Your file never leaves your browser. The text of its clauses, and any question you ask, is sent through SignSure's server to Google's Gemini API to be explained; SignSure does not store or log it, and Google's Gemini API terms apply to it. Only your language and reading-level choices are saved in this browser, and Clear everything removes the document from this page.",
  'app.footerNote':
    'SignSure is an educational tool. It does not create a lawyer-client relationship and its output may be incomplete or wrong. Laws differ by state and change over time. Please consult a qualified advocate before relying on any interpretation.',
  'app.startOver': 'Clear everything',
  'app.startOverHint': 'Removes your document and this report from this browser.',
  'app.loadFailed':
    'This part of SignSure did not load, usually because the site was just updated. Reloading the page fixes it. Your document is never stored, so you will need to add it again.',
  'app.reload': 'Reload the page',

  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.hi': 'हिन्दी (Hindi)',
  'readingLevel.label': 'Reading level',
  'readingLevel.simple': 'Simple',
  'readingLevel.standard': 'Standard',

  /* ------------------------------------ home ------------------------------------ */
  'home.heading': 'Understand every clause before you sign.',
  'home.intro':
    'SignSure reads an Indian offer letter or employment agreement and explains it clause by clause, showing you the original text behind every answer.',
  'home.trust1Title': 'Shows its sources',
  'home.trust1Body':
    'Every explanation sits beside the exact clause it came from, with the page number.',
  'home.trust2Title': 'Says when it does not know',
  'home.trust2Body':
    'If your document is silent on something, SignSure says so and tells you what to ask instead.',
  'home.trust3Title': 'Your file stays on your device',
  'home.trust3Body':
    "The file is read inside your browser. Only its clause text is sent, through our server, to Google's Gemini API to be explained. Nothing is stored.",
  'home.cta': 'Check my offer letter',

  /* ----------------------------------- upload ----------------------------------- */
  'upload.heading': 'Add your document',
  'upload.tabFile': 'Upload a file',
  'upload.tabPaste': 'Paste the text',
  'upload.dropzoneHint': 'PDF, Word (.docx) or plain text, up to 10 MB.',
  'upload.chooseFile': 'Choose a file',
  'upload.dropHere': 'Drop your file here',
  'upload.pasteLabel': 'Paste your offer letter',
  'upload.pasteHint': 'Copy the whole letter, including the clause numbers.',
  'upload.pasteAction': 'Read this text',
  'upload.sampleAction': 'Try with a sample offer letter',
  'upload.sampleNote':
    'A made-up letter, so you can see how SignSure works without uploading anything.',
  'upload.reading': 'Reading your document…',
  'upload.parsedPages': 'We found {clauses} clauses across {pages} pages.',
  'upload.parsedNoPages': 'We found {clauses} clauses.',
  'upload.truncated':
    'This document is longer than {pages} pages. SignSure read the first {pages} pages only.',

  /* ------------------------------- upload errors -------------------------------- */
  'upload.error.TOO_LARGE':
    'This file is {sizeMb} MB. Please upload a file under {limitMb} MB, or paste the text instead.',
  'upload.error.EMPTY': 'That file is empty. Please choose another one.',
  'upload.error.UNSUPPORTED_TYPE':
    'SignSure can read PDF, Word (.docx) and plain text files. This one is {extension}.',
  'upload.error.CONTENT_MISMATCH':
    'This file does not look like a {claimed} inside, even though its name says it is. Please check the file and try again.',
  'upload.error.SCANNED_PDF':
    'This PDF looks like scanned images rather than text, so there is nothing for SignSure to read. Try asking for a text PDF, or paste the text in yourself.',
  'upload.error.NO_TEXT': 'SignSure could not find any readable text in that document.',
  'upload.error.TOO_MUCH_TEXT':
    'This document has {chars} characters, which is over the {limit} character limit. Try the employment agreement on its own.',
  'upload.error.ENCRYPTED':
    'This PDF is password protected. Please remove the password and try again.',
  'upload.error.CORRUPT': 'This PDF could not be read. It may be damaged.',
  'upload.error.UNKNOWN': 'Something went wrong reading that document. Please try again.',

  /* ------------------------------------ lenses ---------------------------------- */
  'lenses.heading': 'What are you most worried about?',
  'lenses.intro':
    'Pick as many as you like. This changes the order of the report, not what it finds: a serious clause always appears, whatever you choose.',
  'lenses.QUIT_EARLY': 'I might quit early',
  'lenses.QUIT_EARLY.hint': 'Notice period, bonds, what leaving would cost you',
  'lenses.FUTURE_JOBS': 'My next job',
  'lenses.FUTURE_JOBS.hint': 'Non-compete, non-solicit, confidentiality',
  'lenses.SALARY': 'My salary',
  'lenses.SALARY.hint': 'CTC breakup, variable pay, deductions, clawbacks',
  'lenses.GETTING_FIRED': 'Being let go',
  'lenses.GETTING_FIRED.hint': 'Termination, probation, notice from the company',
  'lenses.EVERYTHING': 'Show me everything',
  'lenses.EVERYTHING.hint': 'No particular focus',
  'lenses.analyse': 'Analyse my document',
  'lenses.back': 'Back',

  /* ------------------------------------ report ---------------------------------- */
  'report.heading': 'Your report',
  'report.tab.overview': 'Overview',
  'report.tab.clauses': 'Clauses',
  'report.tab.ask': 'Ask',
  'report.tab.compare': 'Compare',
  'report.tab.prepare': 'Prepare',
  'report.tabsLabel': 'Report sections',

  'report.loading': 'Reading your clauses and checking every quote…',
  'report.ready': 'Your report is ready.',
  'report.retry': 'Try again',

  'report.verifiedCount':
    '{verified} of {total} explanations are backed by a quote we checked against your document.',
  'report.partial':
    'Part of this document could not be analysed, so this report may be missing some clauses. Try again, or check the whole document yourself.',
  'report.unverifiedNote':
    '{count} could not be checked. Those are listed separately and are not counted as red flags.',

  /* ----------------------------------- overview --------------------------------- */
  'overview.summaryHeading': 'At a glance',
  'overview.notStated': 'Not stated',
  'overview.summarySources':
    'Summarised by the AI from {clauses}. Check each value against those clauses before relying on it.',
  'overview.summaryNoSources':
    'Summarised by the AI. Check each value against your document before relying on it.',
  'overview.documentType': 'Document type',
  'overview.employer': 'Employer',
  'overview.role': 'Role',
  'overview.startDate': 'Start date',
  'overview.noticePeriod': 'Notice period',
  'overview.probation': 'Probation',
  'overview.bondOrPenalty': 'Bond or exit penalty',
  'overview.redFlagsHeading': 'Worth a close look',
  'overview.noRedFlags':
    'SignSure did not find a high-risk clause in this document. That is not the same as the document being fine, so please still read it in full.',
  'overview.rulesHeading': 'Legal context for India',
  'overview.missingHeading': 'What this document does not say',
  'overview.missingIntro':
    'These are things an offer letter usually covers. Yours does not, so they are worth asking about.',
  'overview.unverifiedHeading': 'We could not check these',
  'overview.unverifiedIntro':
    'SignSure could not find a matching quote in your document for the explanations below, so they are shown separately and should not be relied on.',

  /* ------------------------------------ clauses --------------------------------- */
  'clauses.heading': 'Every clause',
  'clauses.filterCategory': 'Category',
  'clauses.filterRisk': 'Risk level',
  'clauses.filterAll': 'All',
  'clauses.search': 'Search the clauses',
  'clauses.searchHint': 'Searches the original text of your document.',
  'clauses.none': 'No clauses match these filters.',
  'clauses.goTo': 'Go to {clause}',
  'clauses.noNotes': 'SignSure has no notes on this clause.',
  'clauses.count': 'Showing {shown} of {total} clauses.',
  'clauses.viewOriginal': 'View the original text',
  'clauses.hideOriginal': 'Hide the original text',
  'clauses.explanation': 'Explanation',
  'clauses.originalText': 'Original text',
  'clauses.clauseLabel': 'Clause {label}',
  'clauses.page': 'Page {page}',
  'clauses.pageRange': 'Pages {page} to {pageEnd}',
  'clauses.paragraph': 'Paragraph {order}',
  'clauses.whyItMatters': 'Why this matters',
  'clauses.questionsToAsk': 'Questions you could ask',

  /* -------------------------------------- risk ---------------------------------- */
  'category.NOTICE_PERIOD': 'Notice period',
  'category.BOND_OR_EXIT_PENALTY': 'Bond or exit penalty',
  'category.NON_COMPETE': 'Non-compete',
  'category.NON_SOLICIT': 'Non-solicitation',
  'category.CONFIDENTIALITY': 'Confidentiality',
  'category.IP_ASSIGNMENT': 'Intellectual property',
  'category.COMPENSATION': 'Salary and pay',
  'category.PROBATION': 'Probation',
  'category.TERMINATION': 'Termination',
  'category.WORKING_HOURS_LEAVE': 'Hours and leave',
  'category.BENEFITS': 'Benefits',
  'category.MOONLIGHTING': 'Other work',
  'category.DISPUTE_RESOLUTION': 'Disputes',
  'category.DOCUMENT_RETENTION': 'Keeping your documents',
  'category.GENERAL': 'General',
  'category.OTHER': 'Other',
  'risk.high': 'High risk',
  'risk.medium': 'Worth checking',
  'risk.low': 'Standard',
  'risk.info': 'Background',

  'verify.verified': 'Verified quote',
  'verify.verifiedHint': 'This exact text was found in your document.',
  'verify.fuzzy': 'Close match',
  'verify.fuzzyHint': 'Nearly identical text was found in your document.',
  'verify.unverified': 'Could not verify',
  'verify.unverifiedHint': 'We could not find this text in your document.',

  /* ------------------------------------ rule card -------------------------------- */
  'rule.basis': 'Based on',
  'rule.lastReviewed': 'Last reviewed {date}',
  'rule.generalInfo': 'This is general information, not advice about your situation.',
  'rule.questions': 'Questions to ask',
  'rule.detail.amount': 'Amount',
  'rule.detail.period': 'Period',
  'rule.detail.yours': 'Your notice',
  'rule.detail.theirs': "The company's notice",

  /* --------------------------------------- ask ----------------------------------- */
  'ask.heading': 'Ask about your document',
  'ask.intro':
    'SignSure answers only from the document you gave it. If your document does not cover something, it will say so.',
  'ask.label': 'Your question',
  'ask.placeholder': 'For example: what happens if I leave after one year?',
  'ask.send': 'Ask',
  'ask.sending': 'Looking through your document…',
  'ask.suggested': 'Questions other people ask',
  'ask.answeredStatus': 'Answered from your document',
  'ask.notInDocumentStatus': 'Your document does not say this',
  'ask.needsProfessionalStatus': 'Worth asking a lawyer',
  'ask.citations': 'Where this comes from',
  'ask.citationButton': 'Go to clause {label}',
  'ask.missingInfo': 'What is missing',
  'ask.suggestedNext': 'You could ask',
  'ask.empty': 'No questions yet. Try one of the suggestions below.',
  'ask.tooLong': 'Please keep your question under {limit} characters.',
  'ask.answerRegion': 'Answers',

  'ask.q.noticePeriod': 'What is my notice period?',
  'ask.q.bondCost': 'What would it cost me to leave in the first year?',
  'ask.q.noticeBuyout': 'Can I buy out my notice period?',
  'ask.q.joinCompetitor': 'Can they stop me from joining a competitor?',
  'ask.q.sideProjects': 'Can I work on my own side projects?',
  'ask.q.confidentialAfter': 'What must I keep confidential after I leave?',
  'ask.q.inHandSalary': 'What will my monthly in-hand salary be?',
  'ask.q.variablePay': 'Which part of my pay is variable?',
  'ask.q.deductions': 'What can be deducted from my salary?',
  'ask.q.terminationNotice': 'How much notice must the company give me?',
  'ask.q.probationRules': 'What happens during probation?',
  'ask.q.disputeForum': 'Where would a dispute be decided?',
  'ask.q.biggestRisk': 'What is the riskiest clause in this document?',
  'ask.q.missingInfo': 'What does this document not tell me?',
  'ask.q.negotiate': 'What could I try to negotiate?',

  /* ------------------------------------- compare --------------------------------- */
  'compare.heading': 'Compare two versions',
  'compare.intro':
    'Add the revised offer and SignSure will show what changed. Your first document stays as it is.',
  'compare.run': 'Compare the two versions',
  'compare.running': 'Comparing the two versions…',
  'compare.noChanges': 'Nothing meaningful changed between these two versions.',
  'compare.unchanged': '{count} clauses are unchanged.',
  'compare.changeType.ADDED': 'Added',
  'compare.changeType.REMOVED': 'Removed',
  'compare.changeType.CHANGED': 'Changed',
  'compare.impact.BETTER_FOR_EMPLOYEE': 'Better for you',
  'compare.impact.WORSE_FOR_EMPLOYEE': 'Worse for you',
  'compare.impact.NEUTRAL': 'No real difference',
  'compare.impact.UNCLEAR': 'Unclear',
  'compare.changeColumn': 'Change',
  'compare.versionA': 'Original',
  'compare.versionB': 'Revised',
  'compare.tableLabel': 'Changes between the two versions',

  /* ------------------------------------- prepare --------------------------------- */
  'prepare.heading': 'Prepare for the conversation',
  'prepare.intro':
    'A sheet you can take to HR or a lawyer. The questions marked as reviewed come from our India rule library, not from the AI.',
  'prepare.build': 'Build my preparation sheet',
  'prepare.building': 'Putting your sheet together…',
  'prepare.checklist': 'Before you sign',
  'prepare.questionsForHR': 'Questions for HR',
  'prepare.questionsForLawyer': 'Questions for a lawyer',
  'prepare.missingInformation': 'Information you still need',
  'prepare.documentsToBring': 'Documents to bring',
  'prepare.print': 'Print',
  'prepare.copy': 'Copy',
  'prepare.copied': 'Copied to your clipboard.',
  'prepare.copyFailed': 'Could not copy automatically. Please use Download or Print instead.',
  'prepare.exportTitle': 'Preparing to discuss your offer',
  'prepare.exportDocument': 'Document: {name}',
  'prepare.exportFlagged': 'Clauses worth a close look',
  'prepare.exportFooter':
    'Prepared with SignSure. This is information, not legal advice. Please confirm anything important with a qualified advocate.',
  'highlight.end': 'end of highlight',
  'report.highRiskCount': '{count} high-risk',
  'prepare.download': 'Download as .md',
  'prepare.checkboxHint': 'Ticking a box is just for you. Nothing is saved.',

  /* -------------------------------------- errors --------------------------------- */
  'error.INVALID_INPUT': 'Something about that request was not right. Please try again.',
  'error.UNAUTHORIZED':
    'Your session needed renewing, and SignSure is renewing it now. Please try again in a moment. Your document is still here.',
  'error.TOO_LARGE': 'That document is too large to analyse. Try a shorter one.',
  'error.RATE_LIMITED': 'You have made a lot of requests. Please wait a minute and try again.',
  'error.MODEL_BLOCKED':
    'The assistant could not process this document. If it contains unusual content, try the employment agreement on its own.',
  'error.MODEL_INVALID_OUTPUT': 'The assistant returned something unusable. Please try again.',
  'error.UPSTREAM_TIMEOUT': 'That took too long. Please try again.',
  'error.INTERNAL': 'Something went wrong on our side. Please try again.',
  'error.heading': 'That did not work',
  'error.offline': 'You appear to be offline. Please check your connection and try again.',

  /* ------------------------------------ a11y tools ------------------------------- */
  'readAloud.play': 'Read aloud',
  'readAloud.stop': 'Stop reading',
  'glossary.open': 'What does {term} mean?',
  'glossary.close': 'Close',
  'glossary.liquidatedDamages.definition':
    'A sum the contract says you will pay if you break a term, such as leaving early. Courts in India generally award only a reasonable amount, not automatically the full figure.',
  'glossary.arbitration.definition':
    'A private way of settling a dispute outside court, decided by an arbitrator instead of a judge. It can be costly, and the contract may say who picks the arbitrator.',
  'glossary.noticePeriod.definition':
    'How long you, or the company, must wait between saying the job will end and the last working day.',
  'glossary.ctc.definition':
    'Cost to company: everything the employer spends on you in a year, including contributions and benefits. Your monthly in-hand pay is lower than CTC divided by twelve.',
  'glossary.indemnity.definition':
    "A promise to cover someone else's losses. If you indemnify the company, you may have to pay for losses it suffers because of something you did.",
  'glossary.probation.definition':
    'A trial period at the start of a job, often with shorter notice and fewer benefits, which ends when you are confirmed in writing.',
  'glossary.nonCompete.definition':
    'A term that tries to stop you working for, or starting, a competing business. In India, restrictions that apply after you leave are generally treated very differently from ones that apply while you work there.',
  'glossary.gratuity.definition':
    'A lump sum paid when you leave after a qualifying period of service, set by law rather than chosen by the employer.',
  'glossary.providentFund.definition':
    'PF: a retirement savings scheme. A share of your wages goes into it each month, and the employer adds a matching contribution.',
  'glossary.jurisdiction.definition':
    'Which courts, in which city, would hear a dispute about this contract.',

  /* --------------------------------------- session -------------------------------- */
  'session.failed': 'SignSure could not start a session for this document. Please reload the page.',
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
