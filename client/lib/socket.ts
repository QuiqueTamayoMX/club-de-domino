/// <reference types="vite/client" />
import { io, type Socket } from 'socket.io-client';
import type {
  ClientGameState,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/types';
import { soundEngine } from './soundEngine';

const PLAYER_ID_KEY = 'domino_mx_player_id';
const PLAYER_NAME_KEY = 'domino_mx_player_name';
const ACTIVE_ROOM_KEY = 'domino_mx_active_room';
const PLAYER_ID_COOKIE = 'domino_pid';

function generatePlayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `p_${ts}_${rand}`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
  } catch {
    // Ignore cookie errors
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeDays = 30): void {
  if (typeof document === 'undefined') return;
  try {
    const maxAge = maxAgeDays * 24 * 60 * 60;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  } catch {
    // Ignore cookie errors
  }
}

function persistPlayerId(id: string): void {
  try {
    window.localStorage?.setItem(PLAYER_ID_KEY, id);
  } catch {
    // Ignore storage errors
  }
  try {
    window.sessionStorage?.setItem(PLAYER_ID_KEY, id);
  } catch {
    // Ignore storage errors
  }
  writeCookie(PLAYER_ID_COOKIE, id, 30);
}

export function getPlayerId(): string {
  if (typeof window === 'undefined') {
    return generatePlayerId();
  }

  let existing: string | null = null;
  try {
    existing = window.localStorage?.getItem(PLAYER_ID_KEY) ?? null;
  } catch {
    // Ignore
  }
  if (!existing) {
    try {
      existing = window.sessionStorage?.getItem(PLAYER_ID_KEY) ?? null;
    } catch {
      // Ignore
    }
  }
  if (!existing) {
    existing = readCookie(PLAYER_ID_COOKIE);
  }

  if (existing && existing.trim().length > 0) {
    persistPlayerId(existing);
    return existing;
  }

  const created = generatePlayerId();
  persistPlayerId(created);
  return created;
}

export function getSavedPlayerName(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(PLAYER_NAME_KEY) ?? '';
    }
  } catch {
    // Ignore storage errors
  }
  return '';
}

export function savePlayerName(name: string): void {
  const clean = name.trim();
  try {
    window.localStorage?.setItem(PLAYER_NAME_KEY, clean);
  } catch {
    // Ignore storage errors
  }
  try {
    window.sessionStorage?.setItem(PLAYER_NAME_KEY, clean);
  } catch {
    // Ignore storage errors
  }
}

export function getActiveRoomCode(): string {
  if (typeof window === 'undefined') return '';
  let code = '';
  try {
    code = window.localStorage?.getItem(ACTIVE_ROOM_KEY) ?? '';
  } catch {
    // Ignore
  }
  if (!code) {
    try {
      code = window.sessionStorage?.getItem(ACTIVE_ROOM_KEY) ?? '';
    } catch {
      // Ignore
    }
  }
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export function saveActiveRoomCode(roomCode: string): void {
  const clean = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (clean.length !== 4) return;
  try {
    window.localStorage?.setItem(ACTIVE_ROOM_KEY, clean);
  } catch {
    // Ignore
  }
  try {
    window.sessionStorage?.setItem(ACTIVE_ROOM_KEY, clean);
  } catch {
    // Ignore
  }
}

export function clearActiveRoomCode(): void {
  try {
    window.localStorage?.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // Ignore
  }
  try {
    window.sessionStorage?.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // Ignore
  }
}

export function getSoundMuted(): boolean {
  return soundEngine.isMuted();
}

export function setSoundMuted(muted: boolean): void {
  soundEngine.setMuted(muted);
}

export type AppSocket = Pick<
  Socket<ServerToClientEvents, ClientToServerEvents>,
  'connected' | 'connect' | 'disconnect' | 'on' | 'off' | 'emit'
>;

function shouldUseSocketIO(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_SERVER_URL) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function createNetlifyHttpSocket(): AppSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let connected = false;
  let activeRoomCode: string | null = null;
  let pollTimer: number | null = null;
  let pollInFlight = false;
  let lastToastSignature = '';
  let lifecycleBound = false;

  const trigger = (event: string, ...args: unknown[]) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(...args);
    }
  };

  const emitToastOnce = (
    toast: { type: 'info' | 'success' | 'error'; message: string },
    fromPoll: boolean
  ) => {
    const sig = `${toast.type}:${toast.message}`;
    if (fromPoll && sig === lastToastSignature) return;
    lastToastSignature = sig;
    trigger('toast', toast);
    if (fromPoll) {
      window.setTimeout(() => {
        if (lastToastSignature === sig) lastToastSignature = '';
      }, 3500);
    }
  };

  const callApi = async (
    action: string,
    payload?: Record<string, unknown>,
    fromPoll = false
  ) => {
    try {
      const res = await fetch('/api/domino', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          playerId: getPlayerId(),
          roomCode: activeRoomCode ?? (payload?.roomCode as string | undefined),
          payload: payload ?? {},
        }),
      });
      if (!res.ok) {
        if (!fromPoll) {
          emitToastOnce(
            { type: 'error', message: 'Error de comunicación con la mesa' },
            false
          );
        }
        return;
      }
      const data = (await res.json()) as {
        state?: ClientGameState;
        toast?: { type: 'info' | 'success' | 'error'; message: string };
      };
      if (data.state) {
        activeRoomCode = data.state.roomCode;
        saveActiveRoomCode(data.state.roomCode);
        trigger('state:update', data.state);
      }
      if (data.toast) {
        if (
          data.toast.type === 'error' &&
          (data.toast.message.includes('no existe') ||
            data.toast.message.includes('No estás sentado'))
        ) {
          activeRoomCode = null;
          clearActiveRoomCode();
        }
        emitToastOnce(data.toast, fromPoll);
      }
    } catch {
      if (!fromPoll) {
        emitToastOnce(
          { type: 'error', message: 'Sin conexión con el servidor' },
          false
        );
      }
    }
  };

  const syncNow = () => {
    if (!connected || !activeRoomCode || pollInFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    pollInFlight = true;
    void callApi('room:state', {}, true).finally(() => {
      pollInFlight = false;
    });
  };

  const bindLifecycleSync = () => {
    if (lifecycleBound || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    lifecycleBound = true;

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('pageshow', () => syncNow());
    window.addEventListener('focus', () => syncNow());
    window.addEventListener('online', () => syncNow());
  };

  const startPolling = () => {
    bindLifecycleSync();
    if (pollTimer !== null || typeof window === 'undefined') return;
    pollTimer = window.setInterval(() => {
      syncNow();
    }, 850);
  };

  const adapter: AppSocket = {
    get connected() {
      return connected;
    },
    connect() {
      if (!connected) {
        connected = true;
        startPolling();
        window.setTimeout(() => trigger('connect'), 0);
      }
      return adapter as never;
    },
    disconnect() {
      connected = false;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      trigger('disconnect');
      return adapter as never;
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn);
      return adapter as never;
    },
    off(event: string, fn?: (...args: unknown[]) => void) {
      if (!fn) {
        listeners.delete(event);
      } else {
        listeners.get(event)?.delete(fn);
      }
      return adapter as never;
    },
    emit(event: string, payload?: unknown) {
      void callApi(event, (payload as Record<string, unknown>) ?? {}, false);
      return true as never;
    },
  } as AppSocket;

  return adapter;
}

export const socket: AppSocket = shouldUseSocketIO()
  ? io((import.meta.env.VITE_SERVER_URL as string | undefined) || undefined, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
    })
  : createNetlifyHttpSocket();

export function getSocket(): AppSocket {
  return socket;
}
