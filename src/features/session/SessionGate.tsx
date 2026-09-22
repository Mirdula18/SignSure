import { useCallback } from 'react';
import { createSession } from '@/api/client';
import { useAppState } from '@/state/appState';
import { TurnstileWidget, type TurnstileState } from './TurnstileWidget';

/**
 * Earns the session token every API call needs, by passing Cloudflare Turnstile.
 *
 * `App` renders this in one fixed place from the moment a document is loaded until a session
 * exists, for two reasons:
 * - It has to outlive screen changes. The check takes a second or two, and a reader who picks
 *   the sample straight away used to unmount it mid-challenge, leaving the report waiting for a
 *   session that would never arrive.
 * - It should not run for visitors who never add a document: that is 120 KB of third-party
 *   script, and a call to Cloudflare, for someone who has only read the home page.
 */
export function SessionGate() {
  const { dispatch } = useAppState();

  const handleToken = useCallback(
    (turnstileToken: string) => {
      createSession(turnstileToken)
        .then((session) => {
          dispatch({ type: 'sessionReady', session });
        })
        .catch(() => {
          // Recorded rather than retried: an analysis waiting on this session can then say so at
          // once instead of waiting for a token that is never coming.
          dispatch({ type: 'sessionFailed' });
        });
    },
    [dispatch],
  );

  const handleState = useCallback(
    (turnstileState: TurnstileState) => {
      if (turnstileState === 'failed') dispatch({ type: 'sessionFailed' });
    },
    [dispatch],
  );

  return <TurnstileWidget onToken={handleToken} onStateChange={handleState} />;
}
