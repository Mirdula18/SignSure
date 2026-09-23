import { useEffect, useRef } from 'react';
import { createSession } from '@/api/client';
import { useAppState } from '@/state/appState';

/**
 * Gets the session token every API call needs.
 *
 * `App` renders this in one fixed place from the moment a document is loaded until a session
 * exists, for two reasons:
 * - It has to outlive screen changes. The request takes a moment, and a reader who picks the
 *   sample straight away used to unmount it mid-flight, leaving the report waiting for a
 *   session that would never arrive.
 * - It should not run for visitors who never add a document: no reason to spend a request, or
 *   a rate-limit slot, on someone who has only read the home page.
 *
 * It renders nothing. There is no challenge to show and nothing for the reader to do.
 */
export function SessionGate() {
  const { dispatch } = useAppState();

  // One request per mount. Without this, StrictMode's double-invoked effect would spend two of
  // the ten sessions an address gets in ten minutes on every single page load.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    createSession()
      .then((session) => {
        dispatch({ type: 'sessionReady', session });
      })
      .catch(() => {
        // Recorded rather than retried: an analysis waiting on this session can then say so at
        // once instead of waiting for a token that is never coming.
        dispatch({ type: 'sessionFailed' });
      });
  }, [dispatch]);

  return null;
}
