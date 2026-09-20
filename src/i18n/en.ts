/**
 * English source dictionary. Every other language is typed against this object, so a missing
 * key is a compile error rather than a silently untranslated string.
 */
export const en = {
  'app.name': 'SignSure',
  'app.tagline': 'Understand every clause before you sign.',
  'app.skipToContent': 'Skip to main content',
  'app.disclaimerShort': 'SignSure explains your document. It is not legal advice.',
  'app.disclaimerLink': 'Read the full disclaimer',
  'app.howItWorks': 'How SignSure works',
  'app.privacy': 'Privacy',
  'app.footerNote':
    'SignSure is an educational tool. It does not create a lawyer-client relationship and its output may be incomplete or wrong. Laws differ by state and change over time. Please consult a qualified advocate before relying on any interpretation.',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.hi': 'हिन्दी (Hindi)',
  'readingLevel.label': 'Reading level',
  'readingLevel.simple': 'Simple',
  'readingLevel.standard': 'Standard',
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
