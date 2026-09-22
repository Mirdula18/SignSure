import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';
import type { Clause, CompareResult } from '@shared/types';
import { CompareTab, type CompareTabProps } from './CompareTab';
import * as parsing from '@/features/parsing/parseDocument';
import { PreferencesProvider } from '@/state/preferences';

// The real parser runs by default; one test swaps in a parser that throws outright.
vi.mock('@/features/parsing/parseDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof parsing>();
  return { ...actual, parseFile: vi.fn(actual.parseFile) };
});

function renderWith(ui: ReactElement) {
  return render(ui, { wrapper: PreferencesProvider });
}

const CLAUSES_A: Clause[] = [
  {
    id: 'c001',
    label: '6.1',
    heading: null,
    text: 'The Employee shall give thirty (30) days written notice.',
    page: 2,
    pageEnd: 2,
    order: 0,
  },
  {
    id: 'c002',
    label: '9',
    heading: null,
    text: 'The Employee shall not join a competitor for twelve months.',
    page: 3,
    pageEnd: 3,
    order: 1,
  },
];

const RESULT: CompareResult = {
  changes: [
    {
      pairId: 'p1',
      changeType: 'CHANGED',
      impact: 'WORSE_FOR_EMPLOYEE',
      summary: 'Your notice period doubles from 30 to 60 days.',
      quoteA: {
        clauseId: 'c001',
        quote: 'thirty (30) days written notice',
        status: 'verified',
        start: 24,
        end: 55,
      },
      quoteB: { clauseId: 'c001', quote: 'sixty (60) days written notice', status: 'fuzzy' },
    },
    {
      pairId: 'p2',
      changeType: 'ADDED',
      impact: 'WORSE_FOR_EMPLOYEE',
      summary: 'A training bond has been added.',
      quoteA: null,
      quoteB: { clauseId: 'c004', quote: 'a bond of two lakh rupees', status: 'unverified' },
    },
    {
      pairId: 'p3',
      changeType: 'REMOVED',
      impact: 'BETTER_FOR_EMPLOYEE',
      summary: 'The non-compete has been removed.',
      quoteA: {
        clauseId: 'c002',
        quote: 'shall not join a competitor for twelve months',
        status: 'verified',
      },
      quoteB: null,
    },
  ],
  unchangedCount: 7,
};

const RUN = 'Compare the two versions';
const RUNNING = 'Comparing the two versions…';
const PARSE_ERROR = 'Something went wrong reading that document. Please try again.';

function props(overrides: Partial<CompareTabProps> = {}): CompareTabProps {
  return {
    result: null,
    status: 'idle',
    errorKey: null,
    clausesA: CLAUSES_A,
    onSecondDocument: vi.fn(),
    onCompare: vi.fn(),
    hasSecondDocument: false,
    ...overrides,
  };
}

function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('CompareTab', () => {
  it('introduces the comparison with a heading', () => {
    renderWith(<CompareTab {...props()} />);
    expect(screen.getByRole('heading', { name: 'Compare two versions' })).toBeInTheDocument();
  });

  describe('before a second document is added', () => {
    it('offers a labelled file picker and no Compare button, since there is nothing to compare yet', () => {
      renderWith(<CompareTab {...props()} />);
      const input = screen.getByLabelText('Choose a file');
      expect(input).toHaveAttribute('type', 'file');
      expect(screen.queryByRole('button', { name: RUN })).not.toBeInTheDocument();
    });

    it('hands the parsed clauses of a readable file to the parent', async () => {
      const user = userEvent.setup();
      const onSecondDocument = vi.fn();
      renderWith(<CompareTab {...props({ onSecondDocument })} />);
      await user.upload(
        screen.getByLabelText('Choose a file'),
        textFile('revised.txt', '1. The Employee shall give sixty (60) days written notice.'),
      );
      await waitFor(() => {
        expect(onSecondDocument).toHaveBeenCalledTimes(1);
      });
      const clauses = onSecondDocument.mock.calls[0]![0] as Clause[];
      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.text).toContain('sixty (60) days');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says specifically why a chosen file cannot be read, such as an image', async () => {
      // applyAccept is off so the .png reaches the component, as it would from a drop or from a
      // browser that ignores `accept`: the component must cope on its own.
      const user = userEvent.setup({ applyAccept: false });
      const onSecondDocument = vi.fn();
      renderWith(<CompareTab {...props({ onSecondDocument })} />);
      await user.upload(
        screen.getByLabelText('Choose a file'),
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'scan.png', { type: 'image/png' }),
      );
      // The specific reason tells the reader what to do next; a generic "could not be read"
      // does not.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /PDF, Word \(\.docx\) and plain text files\. This one is \.png/,
      );
      expect(onSecondDocument).not.toHaveBeenCalled();
    });

    it('shows the alert when the parser throws outright, rather than failing silently', async () => {
      const user = userEvent.setup();
      vi.mocked(parsing.parseFile).mockRejectedValueOnce(new Error('worker crashed'));
      renderWith(<CompareTab {...props()} />);
      await user.upload(screen.getByLabelText('Choose a file'), textFile('revised.txt', 'x'));
      expect(await screen.findByRole('alert')).toHaveTextContent(PARSE_ERROR);
    });

    it('clears the error once a readable file is chosen', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const onSecondDocument = vi.fn();
      renderWith(<CompareTab {...props({ onSecondDocument })} />);
      const input = screen.getByLabelText('Choose a file');
      await user.upload(input, new File(['not a picture'], 'photo.png', { type: 'image/png' }));
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await user.upload(input, textFile('revised.txt', '1. Notice is sixty (60) days.'));
      await waitFor(() => {
        expect(onSecondDocument).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('once a second document is added', () => {
    it('replaces the file picker with a Compare button that runs the comparison', async () => {
      const user = userEvent.setup();
      const onCompare = vi.fn();
      renderWith(<CompareTab {...props({ hasSecondDocument: true, onCompare })} />);
      expect(screen.queryByLabelText('Choose a file')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: RUN }));
      expect(onCompare).toHaveBeenCalledTimes(1);
    });

    it('disables Compare while a comparison is running, so it cannot be started twice', async () => {
      const user = userEvent.setup();
      const onCompare = vi.fn();
      renderWith(
        <CompareTab {...props({ hasSecondDocument: true, status: 'loading', onCompare })} />,
      );
      const run = screen.getByRole('button', { name: RUN });
      expect(run).toBeDisabled();
      await user.click(run);
      expect(onCompare).not.toHaveBeenCalled();
    });
  });

  it('announces a running comparison in a polite live region that was already on the page', () => {
    const { rerender } = renderWith(<CompareTab {...props({ hasSecondDocument: true })} />);
    expect(screen.queryByText(RUNNING)).not.toBeInTheDocument();

    rerender(<CompareTab {...props({ hasSecondDocument: true, status: 'loading' })} />);
    expect(screen.getByText(RUNNING)).toHaveAttribute('aria-live', 'polite');
  });

  it('reports a failed comparison as an alert in words the reader can act on', () => {
    renderWith(
      <CompareTab
        {...props({ hasSecondDocument: true, status: 'error', errorKey: 'error.RATE_LIMITED' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You have made a lot of requests. Please wait a minute and try again.',
    );
  });

  it('shows no alert for an error with no message to give, or a message with no error', () => {
    const { rerender } = renderWith(
      <CompareTab {...props({ hasSecondDocument: true, status: 'error', errorKey: null })} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <CompareTab
        {...props({ hasSecondDocument: true, status: 'ready', errorKey: 'error.INTERNAL' })}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says plainly when nothing meaningful changed, instead of drawing an empty table', () => {
    renderWith(
      <CompareTab
        {...props({
          hasSecondDocument: true,
          status: 'ready',
          result: { changes: [], unchangedCount: 12 },
        })}
      />,
    );
    expect(
      screen.getByText('Nothing meaningful changed between these two versions.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  describe('the table of changes', () => {
    function renderTable() {
      return renderWith(
        <CompareTab {...props({ hasSecondDocument: true, status: 'ready', result: RESULT })} />,
      );
    }

    /** The body row whose row header mentions the given summary. */
    function rowFor(summary: string): HTMLElement {
      const header = screen.getByRole('rowheader', { name: new RegExp(summary) });
      const row = header.closest('tr');
      if (row === null) throw new Error(`No row for ${summary}`);
      return row;
    }

    it('is a real table named by its caption', () => {
      renderTable();
      expect(
        screen.getByRole('table', { name: 'Changes between the two versions' }),
      ).toBeInTheDocument();
    });

    it('has column headers for the original and revised versions', () => {
      renderTable();
      expect(screen.getAllByRole('columnheader')).toHaveLength(3);
      expect(screen.getByRole('columnheader', { name: 'Original' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Revised' })).toBeInTheDocument();
    });

    // Suspected bug: the first column holds Added, Removed and Changed rows alike, but its header
    // reuses the "Changed" label, so a screen reader announces "Changed" as the column name even
    // on an "Added" row.
    it('names the first column for what it holds, not after one of the values in it', () => {
      renderTable();
      const [first] = screen.getAllByRole('columnheader');
      expect(first).not.toHaveAccessibleName('Changed');
    });

    it('gives each change a row header with its type, impact in words, and summary', () => {
      renderTable();
      expect(screen.getAllByRole('rowheader')).toHaveLength(3);

      const changed = rowFor('Your notice period doubles');
      const header = within(changed).getByRole('rowheader');
      expect(within(header).getByText('Changed')).toBeInTheDocument();
      expect(within(header).getByText('Worse for you')).toBeInTheDocument();

      const removed = within(rowFor('The non-compete has been removed')).getByRole('rowheader');
      expect(within(removed).getByText('Removed')).toBeInTheDocument();
      expect(within(removed).getByText('Better for you')).toBeInTheDocument();
    });

    it('shows both quotes of a changed clause with a verification badge on each', () => {
      renderTable();
      const [original, revised] = within(rowFor('Your notice period doubles')).getAllByRole('cell');
      expect(within(original!).getByText('thirty (30) days written notice')).toBeInTheDocument();
      expect(within(original!).getByText('Verified quote')).toBeInTheDocument();
      // The original's clause number comes from our own clause data.
      expect(within(original!).getByText('6.1')).toBeInTheDocument();
      expect(within(revised!).getByText('sixty (60) days written notice')).toBeInTheDocument();
      expect(within(revised!).getByText('Close match')).toBeInTheDocument();
    });

    it('shows a dash for the original side of an added clause', () => {
      renderTable();
      const [original, revised] = within(rowFor('A training bond has been added')).getAllByRole(
        'cell',
      );
      expect(original).toHaveTextContent(/^—$/);
      expect(within(revised!).getByText('a bond of two lakh rupees')).toBeInTheDocument();
      expect(within(revised!).getByText('Could not verify')).toBeInTheDocument();
    });

    it('shows a dash for the revised side of a removed clause', () => {
      renderTable();
      const [original, revised] = within(rowFor('The non-compete has been removed')).getAllByRole(
        'cell',
      );
      expect(
        within(original!).getByText('shall not join a competitor for twelve months'),
      ).toBeInTheDocument();
      expect(within(original!).getByText('Verified quote')).toBeInTheDocument();
      expect(revised).toHaveTextContent(/^—$/);
    });

    it('leaves the clause number blank when the quote points at a clause it does not know', () => {
      renderWith(
        <CompareTab
          {...props({
            hasSecondDocument: true,
            status: 'ready',
            result: {
              changes: [
                {
                  ...RESULT.changes[0]!,
                  quoteA: { clauseId: 'c999', quote: 'thirty days', status: 'fuzzy' },
                },
              ],
              unchangedCount: 0,
            },
          })}
        />,
      );
      const [original] = screen.getAllByRole('cell');
      expect(within(original!).getByText('thirty days')).toBeInTheDocument();
      // Rather than a wrong number, or a raw id the reader cannot use.
      expect(within(original!).queryByText('6.1')).not.toBeInTheDocument();
      expect(within(original!).queryByText('9')).not.toBeInTheDocument();
      expect(within(original!).queryByText('c999')).not.toBeInTheDocument();
    });

    it('says how many clauses did not change', () => {
      renderTable();
      expect(screen.getByText('7 clauses are unchanged.')).toBeInTheDocument();
    });

    it('has no axe violations', async () => {
      const { container } = renderTable();
      await expect(axe(container)).resolves.toHaveNoViolations();
    });
  });

  it('has no axe violations before a second document is added', async () => {
    const { container } = renderWith(<CompareTab {...props()} />);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
