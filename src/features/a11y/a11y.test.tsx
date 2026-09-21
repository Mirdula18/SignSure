import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { GLOSSARY_TERMS, splitOnGlossaryTerms } from './glossary';
import { GlossaryText } from './GlossaryText';
import { pickVoice, ReadAloud } from './ReadAloud';
import { en } from '@/i18n';
import { renderWithPreferences } from '@/test/factories';

describe('splitOnGlossaryTerms', () => {
  it('returns plain text untouched when it contains no terms', () => {
    expect(splitOnGlossaryTerms('Nothing special here.')).toEqual(['Nothing special here.']);
  });

  it('marks a term and keeps the text around it', () => {
    expect(splitOnGlossaryTerms('You may owe liquidated damages if you leave.')).toEqual([
      'You may owe ',
      { term: 'liquidatedDamages', text: 'liquidated damages' },
      ' if you leave.',
    ]);
  });

  it('marks only the first occurrence of each term', () => {
    const segments = splitOnGlossaryTerms('Arbitration, then more arbitration.');
    expect(segments.filter((segment) => typeof segment !== 'string')).toHaveLength(1);
  });

  it('keeps the original capitalisation of the matched text', () => {
    const segments = splitOnGlossaryTerms('Arbitration applies.');
    expect(segments[0]).toEqual({ term: 'arbitration', text: 'Arbitration' });
  });

  it('marks several different terms in document order', () => {
    const segments = splitOnGlossaryTerms('Your CTC is fixed but probation can be extended.');
    const terms = segments.filter((segment) => typeof segment !== 'string');
    expect(terms.map((segment) => segment.term)).toEqual(['ctc', 'probation']);
  });

  it('does not match a term inside a longer word', () => {
    // "PF" must not light up inside an unrelated word.
    expect(splitOnGlossaryTerms('The PFIZER contract')).toEqual(['The PFIZER contract']);
  });

  it('finds Hindi forms of a term, which ASCII word boundaries would miss', () => {
    const segments = splitOnGlossaryTerms('आपका नोटिस पीरियड नब्बे दिन का है।');
    expect(
      segments.some((segment) => typeof segment !== 'string' && segment.term === 'noticePeriod'),
    ).toBe(true);
  });

  it('has a definition in the English dictionary for every term', () => {
    for (const term of GLOSSARY_TERMS) {
      expect(en).toHaveProperty(`glossary.${term}.definition`);
    }
  });
});

describe('GlossaryText', () => {
  it('renders each term as a button that reveals its definition, and hides it again', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<GlossaryText text="There is an arbitration clause." />);

    const button = screen.getByRole('button', { name: 'arbitration' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('note', { hidden: true })).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(/settling a dispute outside court/i);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and keeps focus on the term', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<GlossaryText text="Check the notice period." />);
    const button = screen.getByRole('button', { name: 'notice period' });

    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('ignores Escape when the definition is already closed', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<GlossaryText text="Check the notice period." />);
    const button = screen.getByRole('button', { name: 'notice period' });
    button.focus();
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('points the button at the definition it controls', () => {
    renderWithPreferences(<GlossaryText text="Your CTC is high." />);
    const button = screen.getByRole('button', { name: 'CTC' });
    const note = screen.getByRole('note', { hidden: true });
    expect(button).toHaveAttribute('aria-controls', note.id);
  });

  it('renders plain text with no buttons when there are no terms', () => {
    renderWithPreferences(<GlossaryText text="Just words." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Just words.')).toBeInTheDocument();
  });

  it('has no axe violations with a definition open', async () => {
    const user = userEvent.setup();
    const { container } = renderWithPreferences(
      <p>
        <GlossaryText text="Probation may be extended." />
      </p>,
    );
    await user.click(screen.getByRole('button', { name: 'Probation' }));
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe('pickVoice', () => {
  const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;

  it('prefers an exact locale match', () => {
    const voices = [voice('hi'), voice('en-GB'), voice('en-IN')];
    expect(pickVoice(voices, 'en-IN')?.lang).toBe('en-IN');
  });

  it('falls back to the same language in another region', () => {
    expect(pickVoice([voice('fr-FR'), voice('en-US')], 'en-IN')?.lang).toBe('en-US');
  });

  it('accepts a bare language code', () => {
    expect(pickVoice([voice('hi')], 'hi-IN')?.lang).toBe('hi');
  });

  it('returns nothing when no voice fits, so the browser default is used', () => {
    expect(pickVoice([voice('fr-FR')], 'hi-IN')).toBeUndefined();
  });
});

describe('ReadAloud', () => {
  class FakeUtterance {
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }

  const speech = {
    speak: vi.fn<(utterance: FakeUtterance) => void>(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [{ lang: 'en-IN' }, { lang: 'hi-IN' }] as SpeechSynthesisVoice[]),
  };

  // Defined on `window` directly: the component reads `window.speechSynthesis`, and in the jsdom
  // environment `window` and `globalThis` are not the same object.
  function installSpeech() {
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true,
    });
  }

  function removeSpeech() {
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
  }

  beforeEach(() => {
    installSpeech();
  });

  afterEach(() => {
    // Unmount first: a component still speaking cancels speech as it goes, and it needs the
    // speech engine to still be there when it does.
    cleanup();
    removeSpeech();
    vi.clearAllMocks();
  });

  function lastUtterance(): FakeUtterance {
    const call = speech.speak.mock.calls.at(-1);
    if (!call) throw new Error('nothing was spoken');
    return call[0];
  }

  it('reads the text in an Indian English voice and names what it is reading', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<ReadAloud label="Notice period" text="You must give ninety days." />);

    await user.click(screen.getByRole('button', { name: 'Read aloud: Notice period' }));
    const utterance = lastUtterance();
    expect(utterance.text).toBe('You must give ninety days.');
    expect(utterance.lang).toBe('en-IN');
    expect(utterance.voice?.lang).toBe('en-IN');
  });

  it('uses a Hindi voice when the interface is in Hindi', async () => {
    // Preferences are restored from sessionStorage on mount, so this starts the app in Hindi.
    sessionStorage.setItem(
      'signsure.prefs',
      JSON.stringify({ language: 'hi', readingLevel: 'standard' }),
    );
    try {
      const user = userEvent.setup();
      renderWithPreferences(<ReadAloud label="नोटिस" text="नोटिस अवधि नब्बे दिन है।" />);
      await user.click(screen.getByRole('button'));
      expect(lastUtterance().lang).toBe('hi-IN');
      expect(lastUtterance().voice?.lang).toBe('hi-IN');
    } finally {
      sessionStorage.clear();
    }
  });

  it('becomes a stop button while speaking, and stops when pressed', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<ReadAloud label="Bond" text="You would owe two lakh." />);

    await user.click(screen.getByRole('button', { name: /read aloud: bond/i }));
    const stop = screen.getByRole('button', { name: /stop reading: bond/i });
    expect(stop).toHaveAttribute('aria-pressed', 'true');

    await user.click(stop);
    expect(speech.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /read aloud: bond/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('returns to play when speech finishes or fails', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<ReadAloud label="A" text="Some text." />);

    await user.click(screen.getByRole('button', { name: /read aloud: a/i }));
    act(() => {
      lastUtterance().onend?.();
    });
    expect(screen.getByRole('button', { name: /read aloud: a/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /read aloud: a/i }));
    act(() => {
      lastUtterance().onerror?.();
    });
    expect(screen.getByRole('button', { name: /read aloud: a/i })).toBeInTheDocument();
  });

  it('cancels any other speech first, so only one thing reads at a time', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<ReadAloud label="A" text="Some text." />);
    await user.click(screen.getByRole('button', { name: /read aloud: a/i }));
    expect(speech.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      speech.speak.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('stops speaking when it disappears mid-sentence', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithPreferences(<ReadAloud label="A" text="Some text." />);
    await user.click(screen.getByRole('button', { name: /read aloud: a/i }));
    speech.cancel.mockClear();
    unmount();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it('keeps the default voice when no voice matches the language', async () => {
    speech.getVoices.mockReturnValueOnce([{ lang: 'fr-FR' }] as SpeechSynthesisVoice[]);
    const user = userEvent.setup();
    renderWithPreferences(<ReadAloud label="A" text="Some text." />);
    await user.click(screen.getByRole('button', { name: /read aloud: a/i }));
    expect(lastUtterance().voice).toBeNull();
  });

  it('renders nothing when the browser cannot speak, rather than a button that does nothing', () => {
    // jsdom has no speech support of its own, which is exactly the unsupported case.
    removeSpeech();
    const { container } = renderWithPreferences(<ReadAloud label="A" text="Some text." />);
    expect(container).toBeEmptyDOMElement();
  });
});
