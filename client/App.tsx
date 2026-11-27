import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, WifiOff } from 'lucide-react';
import type { ClientGameState } from '../shared/types';
import {
  getPlayerId,
  getSavedPlayerName,
  savePlayerName,
  socket,
} from './lib/socket';
import { soundEngine } from './lib/soundEngine';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { GameScreen } from './components/GameScreen';

interface ToastItem {
  id: number;
  type: 'info' | 'success' | 'error';
  message: string;
}

function readSalaParam(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = new URLSearchParams(window.location.search).get('sala') ?? '';
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  } catch {
    return '';
  }
}

export function App() {
  const [playerId] = useState<string>(() => getPlayerId());
  const [playerName, setPlayerName] = useState<string>(() => getSavedPlayerName());
  const [initialRoomCode] = useState<string>(() => readSalaParam());
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(() => socket.connected);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const prevGameStateRef = useRef<ClientGameState | null>(null);
  const latestRoomCodeRef = useRef<string | null>(null);
  const playerNameRef = useRef<string>(playerName);
  const toastIdRef = useRef(0);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    latestRoomCodeRef.current = gameState?.roomCode ?? null;
  }, [gameState?.roomCode]);

  const addToast = useCallback(
    (payload: { type: 'info' | 'success' | 'error'; message: string }) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev.slice(-2), { id, ...payload }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 3200);
    },
    []
  );

  const handleToggleMute = useCallback(() => {
    const nextMuted = soundEngine.toggleMuted();
    setSoundMuted(nextMuted);
  }, []);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      setIsConnected(true);
      // Seamless rejoin on socket reconnect if already inside a room
      const activeRoom = latestRoomCodeRef.current;
      if (activeRoom) {
        socket.emit('room:join', {
          roomCode: activeRoom,
          playerName: playerNameRef.current.trim() || 'Jugador',
          playerId,
        });
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onStateUpdate = (nextState: ClientGameState) => {
      const prevState = prevGameStateRef.current;
      prevGameStateRef.current = nextState;
      setGameState(nextState);

      // Sync ?sala=XXXX in URL so refreshing or sharing keeps room code
      if (typeof window !== 'undefined' && nextState.roomCode) {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get('sala') !== nextState.roomCode) {
            url.searchParams.set('sala', nextState.roomCode);
            window.history.replaceState({}, '', url.toString());
          }
        } catch {
          // Ignore history API errors
        }
      }

      // Trigger audio feedback on state transitions
      const prevActionTs = prevState?.lastAction?.timestamp ?? 0;
      const nextAction = nextState.lastAction;
      const hasNewAction = Boolean(nextAction && nextAction.timestamp !== prevActionTs);

      if (hasNewAction && nextAction) {
        if (nextAction.type === 'start') {
          soundEngine.playShuffle();
        } else if (nextAction.type === 'play') {
          soundEngine.playTileClack();
        } else if (nextAction.type === 'pass') {
          soundEngine.playKnock();
        }
      } else if (
        prevState &&
        prevState.phase !== 'playing' &&
        nextState.phase === 'playing'
      ) {
        soundEngine.playShuffle();
      }

      const handJustEnded =
        prevState &&
        prevState.phase === 'playing' &&
        (nextState.phase === 'hand_over' || nextState.phase === 'match_over');

      if (handJustEnded) {
        window.setTimeout(() => {
          soundEngine.playVictory();
        }, 180);
      }

      const wasMyTurn =
        prevState?.phase === 'playing' &&
        prevState.currentTurn !== null &&
        prevState.currentTurn === prevState.mySeat;
      const isMyTurn =
        nextState.phase === 'playing' &&
        nextState.currentTurn !== null &&
        nextState.currentTurn === nextState.mySeat;

      if (isMyTurn && !wasMyTurn) {
        window.setTimeout(() => {
          soundEngine.playTurnPing();
        }, hasNewAction ? 140 : 0);
      }
    };

    const onToast = (payload: { type: 'info' | 'success' | 'error'; message: string }) => {
      addToast(payload);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:update', onStateUpdate);
    socket.on('toast', onToast);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:update', onStateUpdate);
      socket.off('toast', onToast);
    };
  }, [addToast, playerId]);

  const handleCreateRoom = useCallback(
    (name: string) => {
      const cleanName = name.trim();
      if (!cleanName) {
        addToast({ type: 'error', message: 'Escribe tu nombre para crear la mesa' });
        return;
      }
      setPlayerName(cleanName);
      savePlayerName(cleanName);
      socket.emit('room:create', { playerName: cleanName, playerId });
    },
    [addToast, playerId]
  );

  const handleJoinRoom = useCallback(
    (roomCode: string, name: string) => {
      const cleanName = name.trim();
      const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cleanName) {
        addToast({ type: 'error', message: 'Escribe tu nombre antes de entrar' });
        return;
      }
      if (cleanCode.length !== 4) {
        addToast({ type: 'error', message: 'Ingresa el código de 4 caracteres de la mesa' });
        return;
      }
      setPlayerName(cleanName);
      savePlayerName(cleanName);
      socket.emit('room:join', {
        roomCode: cleanCode,
        playerName: cleanName,
        playerId,
      });
    },
    [addToast, playerId]
  );

  return (
    <div className="relative min-h-[100dvh] w-full felt-table text-stone-100 overflow-x-hidden">
      {/* Reconnect indicator */}
      {gameState && !isConnected && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] safe-top pointer-events-none">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-950/95 border border-rose-400/50 text-rose-100 text-xs font-semibold shadow-lg backdrop-blur-sm">
            <WifiOff className="w-3.5 h-3.5 text-rose-300 animate-pulse" />
            <span>Reconectando a la mesa...</span>
          </div>
        </div>
      )}

      {/* Mobile Toast Stack */}
      <div
        aria-live="polite"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] safe-top flex flex-col items-center gap-1.5 w-[92%] max-w-sm pointer-events-none"
      >
        {toasts.map((toast) => {
          const styles =
            toast.type === 'error'
              ? 'bg-rose-950/95 border-rose-400/50 text-rose-100'
              : toast.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-400/50 text-emerald-100'
                : 'bg-[#2a170d]/95 border-amber-400/45 text-amber-100';
          const Icon =
            toast.type === 'error'
              ? AlertCircle
              : toast.type === 'success'
                ? CheckCircle2
                : Info;
          const iconColor =
            toast.type === 'error'
              ? 'text-rose-300'
              : toast.type === 'success'
                ? 'text-emerald-300'
                : 'text-amber-300';

          return (
            <div
              key={toast.id}
              className={`w-full flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold shadow-xl backdrop-blur-md animate-tile-pop ${styles}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
              <span className="leading-snug">{toast.message}</span>
            </div>
          );
        })}
      </div>

      {/* Screen Router */}
      {!gameState ? (
        <HomeScreen
          initialName={playerName}
          initialRoomCode={initialRoomCode}
          isConnected={isConnected}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
        />
      ) : gameState.phase === 'lobby' ? (
        <LobbyScreen
          state={gameState}
          playerId={playerId}
          soundMuted={soundMuted}
          onToggleMute={handleToggleMute}
          onNotify={addToast}
        />
      ) : (
        <GameScreen
          state={gameState}
          playerId={playerId}
          soundMuted={soundMuted}
          onToggleMute={handleToggleMute}
        />
      )}
    </div>
  );
}

export default App;
