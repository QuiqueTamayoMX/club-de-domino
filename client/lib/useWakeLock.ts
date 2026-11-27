import { useEffect } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keeps the phone screen awake during active matches on iOS Safari (16.4+)
 * and Chrome, automatically re-acquiring the lock when returning to the tab.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      return;
    }

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const nextSentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void nextSentinel.release().catch(() => {});
          return;
        }
        sentinel = nextSentinel;
      } catch {
        // Ignore battery-saver or unsupported-context rejections
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
      sentinel = null;
    };
  }, [active]);
}
