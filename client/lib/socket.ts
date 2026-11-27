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

function generatePlayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `p_${ts}_${rand}`;
}

export function getPlayerId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(PLAYER_ID_KEY);
      if (existing && existing.trim().length > 0) {
        return existing;
      }
      const created = generatePlayerId();
      window.localStorage.setItem(PLAYER_ID_KEY, created);
      return created;
    }
  } catch {
    // Fallback if localStorage is unavailable
  }
  return generatePlayerId();
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
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PLAYER_NAME_KEY, name.trim());
    }
  } catch {
    // Ignore storage errors
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
        trigger('state:update', data.state);
      }
      if (data.toast) {
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

  const startPolling = () => {
    if (pollTimer !== null || typeof window === 'undefined') return;
    pollTimer = window.setInterval(() => {
      if (!connected || !activeRoomCode || pollInFlight) return;
      pollInFlight = true;
      void callApi('room:state', {}, true).finally(() => {
        pollInFlight = false;
      });
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
