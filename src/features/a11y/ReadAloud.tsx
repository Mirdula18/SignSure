import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { usePreferences } from '@/state/preferences';
import type { Language } from '@/i18n';

/**
 * Reads an explanation aloud with the browser's own speech engine.
 *
 * For a reader who is more at home in spoken Hindi than in written legal English, hearing the
 * explanation is often the difference between understanding it and not. The Web Speech API does
 * this on the device: no audio is generated on a server and no text leaves the browser for it.
 *
 * The control disappears entirely when the browser has no speech support, rather than
 * rendering a button that does nothing.
 */

/** Voice locale per interface language: Indian English and Hindi voices ship with most phones. */
const LOCALE: Readonly<Record<Language, string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
};

function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

/**
 * Picks the closest voice for a locale: an exact match, then the same language in any region,
 * then whatever the browser defaults to.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  locale: string,
): SpeechSynthesisVoice | undefined {
  const language = locale.split('-')[0] ?? locale;
  return (
    voices.find((voice) => voice.lang === locale) ??
    voices.find((voice) => voice.lang.startsWith(`${language}-`) || voice.lang === language)
  );
}

export interface ReadAloudProps {
  text: string;
  /** What is being read, for the button's accessible name, e.g. the finding title. */
  label: string;
}

export function ReadAloud({ text, label }: ReadAloudProps) {
  const { t, language } = usePreferences();
  const [speaking, setSpeaking] = useState(false);
  const [supported] = useState(speechSupported);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Stop speaking if the reader moves away mid-sentence, so audio never outlives what it reads.
  useEffect(
    () => () => {
      if (utteranceRef.current !== null) window.speechSynthesis.cancel();
    },
    [],
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const play = useCallback(() => {
    // Only one thing reads at a time across the whole page.
    window.speechSynthesis.cancel();

    const utterance = new window.SpeechSynthesisUtterance(text);
    const locale = LOCALE[language];
    utterance.lang = locale;
    const voice = pickVoice(window.speechSynthesis.getVoices(), locale);
    if (voice !== undefined) utterance.voice = voice;
    utterance.rate = 0.95;

    utterance.onend = () => {
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setSpeaking(false);
    };

    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [language, text]);

  if (!supported) return null;

  return (
    <Button
      variant="ghost"
      className="no-print px-2"
      aria-pressed={speaking}
      aria-label={`${speaking ? t('readAloud.stop') : t('readAloud.play')}: ${label}`}
      onClick={speaking ? stop : play}
    >
      <span aria-hidden="true">{speaking ? '■' : '▶'}</span>
      <span>{speaking ? t('readAloud.stop') : t('readAloud.play')}</span>
    </Button>
  );
}
