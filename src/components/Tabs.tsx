import clsx from 'clsx';
import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Tabs following the WAI-ARIA Tabs pattern.
 *
 * Arrow keys move between tabs; Home and End jump to the ends. The handler lives on each tab
 * button rather than on the tablist container, because a container that listens for keys would
 * have to be focusable itself, which puts a useless stop in the tab order.
 *
 * Only the selected tab is reachable with Tab (`tabIndex` 0 versus -1), so Tab moves past the
 * whole tablist into the panel instead of walking through every tab in turn.
 */

export interface TabDefinition<Id extends string> {
  id: Id;
  label: string;
  /** Optional count shown beside the label, e.g. the number of red flags. */
  badge?: number;
  /**
   * What the count means, for screen readers. Without it the tab is announced as "Overview3",
   * a number with no context, run into the word before it.
   */
  badgeLabel?: string;
  disabled?: boolean;
}

export interface TabsProps<Id extends string> {
  tabs: readonly TabDefinition<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  label: string;
  children: ReactNode;
}

export function Tabs<Id extends string>({
  tabs,
  selected,
  onSelect,
  label,
  children,
}: TabsProps<Id>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  /** Moves DOM focus to a tab, so the roving `tabIndex` and the focus ring stay in step. */
  const focusTab = useCallback((index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.item(index)?.focus();
  }, []);

  const activate = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (!tab || tab.disabled === true) return;
      onSelect(tab.id);
      focusTab(index);
    },
    [focusTab, onSelect, tabs],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const current = tabs.findIndex((tab) => tab.id === selected);
      if (current === -1) return;

      /** Steps over disabled tabs, wrapping, and gives up after one full pass. */
      const move = (delta: number): void => {
        let next = current;
        let remaining = tabs.length;
        while (remaining > 0) {
          next = (next + delta + tabs.length) % tabs.length;
          if (tabs[next]?.disabled !== true) break;
          remaining -= 1;
        }
        activate(next);
      };

      const firstEnabled = tabs.findIndex((tab) => tab.disabled !== true);
      const lastEnabled = tabs.reduce(
        (found, tab, index) => (tab.disabled === true ? found : index),
        -1,
      );

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          activate(firstEnabled);
          break;
        case 'End':
          event.preventDefault();
          activate(lastEnabled);
          break;
        default:
          break;
      }
    },
    [activate, selected, tabs],
  );

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={tab.disabled ?? false}
              onKeyDown={onKeyDown}
              onClick={() => {
                activate(index);
              }}
              className={clsx(
                'tap-target -mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isSelected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {tab.badge === undefined || tab.badge === 0 ? null : (
                <>
                  <span
                    aria-hidden={tab.badgeLabel === undefined ? undefined : true}
                    className="ms-2 rounded-full bg-raised px-1.5 text-xs text-ink"
                  >
                    {tab.badge}
                  </span>
                  {tab.badgeLabel === undefined ? null : (
                    <span className="sr-only">, {tab.badgeLabel}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      {/*
        No tabIndex here: the ARIA practices only ask for a focusable panel when it holds no
        focusable content of its own, and every panel in this report does.
      */}
      <div
        role="tabpanel"
        id={`${baseId}-panel-${selected}`}
        aria-labelledby={`${baseId}-tab-${selected}`}
        className="pt-6"
      >
        {children}
      </div>
    </>
  );
}
