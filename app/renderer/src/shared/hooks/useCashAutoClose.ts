import { useEffect } from 'react';
import { useCashStore } from '../store/cash.store';

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'wheel'];

export function useCashAutoClose(): void {
  useEffect(() => {
    let lastActivity = Date.now();
    const markActivity = (): void => {
      lastActivity = Date.now();
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));

    const heartbeat = setInterval(() => {
      const idle = Date.now() - lastActivity >= HEARTBEAT_INTERVAL_MS;
      if (idle) return;
      const session = useCashStore.getState().session;
      if (!session) return;
      void useCashStore.getState().touchActivity();
    }, HEARTBEAT_INTERVAL_MS);

    const unsubscribe = window.api.onCashSessionClosed(({ sessionIds }) => {
      const session = useCashStore.getState().session;
      if (session && sessionIds.includes(session.id)) {
        useCashStore.getState().clearSession();
      }
    });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      clearInterval(heartbeat);
      unsubscribe();
    };
  }, []);
}
