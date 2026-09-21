import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';
import type { PrepareResult } from '@shared/types';
import {
  PrepareSheet,
  toMarkdown,
  type MarkdownText,
  type PrepareSheetProps,
} from './PrepareSheet';
import { PreferencesProvider } from '@/state/preferences';

function renderWith(ui: ReactElement) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}

const SECTION_HEADINGS = {
  'prepare.checklist': 'Before you sign',
  'prepare.questionsForHR': 'Questions for HR',
  'prepare.questionsForLawyer': 'Questions for a lawyer',
  'prepare.missingInformation': 'Information you still need',
  'prepare.documentsToBring': 'Documents to bring',
} as const;

const HEADINGS: MarkdownText = {
  title: 'Preparing to discuss your offer',
  document: (name) => `Document: ${name}`,
  flaggedHeading: 'Clauses worth a close look',
  footer:
    'Prepared with SignSure. This is information, not legal advice. Please confirm anything important with a qualified advocate.',
  sections: SECTION_HEADINGS,
};

const EMPTY: PrepareResult = {
  checklistBeforeSigning: [],
  questionsForHR: [],
  questionsForLawyer: [],
  missingInformation: [],
  documentsToBring: [],
};

const SHEET: PrepareResult = {
  checklistBeforeSigning: ['Ask for the bond terms in writing.'],
  questionsForHR: ['Can the notice period be bought out?', 'Is the joining bonus clawed back?'],
  questionsForLawyer: [],
  missingInformation: ['How many paid leaves you get.'],
  documentsToBring: ['Your last three payslips.'],
};

const FLAGGED: PrepareSheetProps['flagged'] = [
  {
    label: '6.1',
    risk: 'HIGH',
    title: 'Long notice period',
    text: 'The Employee shall give ninety (90) days notice.\nNotice may not be waived.',
  },
];

const DISCLAIMER =
  'Prepared with SignSure. This is information, not legal advice. Please confirm anything important with a qualified advocate.';

const COPIED = 'Copied to your clipboard.';

const COPY_FAILED = 'Could not copy automatically. Please use Download or Print instead.';

describe('toMarkdown', () => {
  it('builds the whole sheet as plain Markdown that opens anywhere', () => {
    expect(toMarkdown(SHEET, 'offer-letter.pdf', FLAGGED, HEADINGS)).toBe(
      [
        '# Preparing to discuss your offer',
        '',
        'Document: offer-letter.pdf',
        '',
        '## Before you sign',
        '',
        '- [ ] Ask for the bond terms in writing.',
        '',
        '## Questions for HR',
        '',
        '- [ ] Can the notice period be bought out?',
        '- [ ] Is the joining bonus clawed back?',
        '',
        '## Information you still need',
        '',
        '- [ ] How many paid leaves you get.',
        '',
        '## Documents to bring',
        '',
        '- [ ] Your last three payslips.',
        '',
        '## Clauses worth a close look',
        '',
        '### 6.1 — Long notice period (HIGH)',
        '',
        '> The Employee shall give ninety (90) days notice.',
        '> Notice may not be waived.',
        '',
        '---',
        '',
        DISCLAIMER,
      ].join('\n'),
    );
  });

  it('keeps the sections in the order the page shows them', () => {
    const full: PrepareResult = {
      checklistBeforeSigning: ['a'],
      questionsForHR: ['b'],
      questionsForLawyer: ['c'],
      missingInformation: ['d'],
      documentsToBring: ['e'],
    };
    const markdown = toMarkdown(full, null, [], HEADINGS);
    const positions = Object.values(SECTION_HEADINGS).map((heading) =>
      markdown.indexOf(`## ${heading}`),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('leaves out empty sections rather than printing a heading with nothing under it', () => {
    const markdown = toMarkdown(SHEET, null, [], HEADINGS);
    expect(markdown).not.toContain('Questions for a lawyer');
  });

  it('writes the document name line only when there is a name', () => {
    expect(toMarkdown(SHEET, 'offer.docx', [], HEADINGS)).toContain('Document: offer.docx\n');
    expect(toMarkdown(SHEET, null, [], HEADINGS)).not.toContain('Document:');
  });

  it('quotes every line of a multi-line flagged clause, so the quote does not break off', () => {
    const markdown = toMarkdown(
      EMPTY,
      null,
      [{ label: '9', risk: 'MEDIUM', title: 'Bond', text: 'one\ntwo\nthree' }],
      HEADINGS,
    );
    expect(markdown).toContain('### 9 — Bond (MEDIUM)\n\n> one\n> two\n> three\n');
  });

  it('omits the flagged-clauses section when nothing was flagged', () => {
    expect(toMarkdown(SHEET, null, [], HEADINGS)).not.toContain('Clauses worth a close look');
  });

  it('always ends with the disclaimer, even for an empty sheet', () => {
    expect(toMarkdown(EMPTY, null, [], HEADINGS)).toBe(
      ['# Preparing to discuss your offer', '', '---', '', DISCLAIMER].join('\n'),
    );
    expect(toMarkdown(SHEET, 'offer.pdf', FLAGGED, HEADINGS).endsWith(DISCLAIMER)).toBe(true);
  });

  it('writes every fixed piece of text in the language it is given, not only the headings', () => {
    // A Hindi reader should get a Hindi file, not English scaffolding around Hindi content.
    const hindi: MarkdownText = {
      title: 'अपने ऑफर पर बात करने की तैयारी',
      document: (name) => `डॉक्यूमेंट: ${name}`,
      flaggedHeading: 'ध्यान से देखने लायक क्लॉज़',
      footer: 'यह जानकारी है, कानूनी सलाह नहीं।',
      sections: { ...SECTION_HEADINGS, 'prepare.questionsForHR': 'HR से सवाल' },
    };
    const markdown = toMarkdown(SHEET, 'offer.pdf', FLAGGED, hindi);
    expect(markdown).toContain('# अपने ऑफर पर बात करने की तैयारी');
    expect(markdown).toContain('डॉक्यूमेंट: offer.pdf');
    expect(markdown).toContain('## HR से सवाल');
    expect(markdown).toContain('## ध्यान से देखने लायक क्लॉज़');
    expect(markdown.endsWith('यह जानकारी है, कानूनी सलाह नहीं।')).toBe(true);
    expect(markdown).not.toContain('Preparing to discuss');
  });
});

describe('PrepareSheet', () => {
  const sheetMarkdown = toMarkdown(SHEET, 'offer-letter.pdf', FLAGGED, HEADINGS);

  function renderSheet() {
    return renderWith(
      <PrepareSheet sheet={SHEET} documentName="offer-letter.pdf" flagged={FLAGGED} />,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('introduces itself with a heading', () => {
    renderSheet();
    expect(
      screen.getByRole('heading', { name: 'Prepare for the conversation' }),
    ).toBeInTheDocument();
  });

  it('renders each non-empty section as a labelled region with a heading and a checklist', () => {
    renderSheet();
    const hr = screen.getByRole('region', { name: 'Questions for HR' });
    expect(within(hr).getByRole('heading', { name: 'Questions for HR' })).toBeInTheDocument();
    const boxes = within(hr).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(
      within(hr).getByRole('checkbox', { name: 'Can the notice period be bought out?' }),
    ).not.toBeChecked();

    for (const heading of ['Before you sign', 'Information you still need', 'Documents to bring']) {
      expect(screen.getByRole('region', { name: heading })).toBeInTheDocument();
    }
  });

  it('shows the sections in the same order as the export', () => {
    renderSheet();
    // Read through the regions rather than a heading level, so the order is what is tested.
    const headings = screen
      .getAllByRole('region')
      .map((region) => within(region).getByRole('heading').textContent);
    expect(headings).toEqual([
      'Before you sign',
      'Questions for HR',
      'Information you still need',
      'Documents to bring',
    ]);
  });

  it('leaves out an empty section entirely', () => {
    renderSheet();
    expect(
      screen.queryByRole('heading', { name: 'Questions for a lawyer' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Questions for a lawyer' }),
    ).not.toBeInTheDocument();
  });

  it('lets the reader tick items off, and says that nothing is saved', async () => {
    const user = userEvent.setup();
    renderSheet();
    const item = screen.getByRole('checkbox', { name: 'Ask for the bond terms in writing.' });
    await user.click(item);
    expect(item).toBeChecked();
    expect(
      screen.getByText('Ticking a box is just for you. Nothing is saved.'),
    ).toBeInTheDocument();
  });

  describe('Copy', () => {
    it('writes the Markdown sheet to the clipboard and announces that it did', async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      renderSheet();
      expect(screen.queryByText(COPIED)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Copy' }));

      expect(writeText).toHaveBeenCalledWith(sheetMarkdown);
      const status = await screen.findByText(COPIED);
      expect(status.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it('announces a second copy too, since a live region only speaks when its content changes', async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      renderSheet();
      const copy = screen.getByRole('button', { name: 'Copy' });

      await user.click(copy);
      const first = await screen.findByText(COPIED);
      await user.click(copy);
      const second = await screen.findByText(COPIED);
      // A fresh node is what makes assistive technology announce it again.
      expect(second).not.toBe(first);
    });

    it('says so when the browser has no clipboard access at all, instead of throwing', async () => {
      const user = userEvent.setup();
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      try {
        renderSheet();
        await user.click(screen.getByRole('button', { name: 'Copy' }));
        expect(await screen.findByText(COPY_FAILED)).toBeInTheDocument();
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
      }
    });

    it('tells the reader when the clipboard refuses, and points them to another way', async () => {
      const user = userEvent.setup();
      let refuse: (reason: unknown) => void = () => undefined;
      vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
      );
      renderSheet();
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      await act(async () => {
        refuse(new DOMException('Denied', 'NotAllowedError'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByText(COPIED)).not.toBeInTheDocument();
      expect(screen.getByText(COPY_FAILED)).toBeInTheDocument();
    });

    it('withdraws an earlier "Copied" when a later copy fails, so it never claims a copy that did not happen', async () => {
      const user = userEvent.setup();
      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
      renderSheet();
      const copy = screen.getByRole('button', { name: 'Copy' });

      await user.click(copy);
      expect(await screen.findByText(COPIED)).toBeInTheDocument();

      await user.click(copy);
      expect(writeText).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(screen.queryByText(COPIED)).not.toBeInTheDocument();
      });
    });
  });

  describe('Download', () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:signsure/sheet');
    const revokeObjectURL = vi.fn<(url: string) => void>();
    const original = {
      create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
      revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
    };

    beforeEach(() => {
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      // jsdom has no object URLs, so both are provided for the length of each test.
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: revokeObjectURL,
      });
    });

    afterEach(() => {
      for (const [name, descriptor] of [
        ['createObjectURL', original.create],
        ['revokeObjectURL', original.revoke],
      ] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(URL, name);
        else Object.defineProperty(URL, name, descriptor);
      }
    });

    it('downloads the same Markdown as a .md file and releases the object URL afterwards', async () => {
      const user = userEvent.setup();
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      renderSheet();

      await user.click(screen.getByRole('button', { name: 'Download as .md' }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0];
      expect(blob.type).toBe('text/markdown;charset=utf-8');
      await expect(blob.text()).resolves.toBe(sheetMarkdown);

      expect(click).toHaveBeenCalledTimes(1);
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.href).toBe('blob:signsure/sheet');
      expect(anchor.download).toBe('signsure-preparation.md');

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:signsure/sheet');
    });
  });

  it('opens the print dialogue from Print', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderSheet();
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('keeps the export buttons out of the printout', () => {
    renderSheet();
    const print = screen.getByRole('button', { name: 'Print' });
    expect(print.parentElement).toHaveClass('no-print');
  });

  it('has no axe violations', async () => {
    const { container } = renderSheet();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
