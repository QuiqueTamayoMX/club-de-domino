import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ClipboardList,
  LogOut,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ClientGameState, Player, SeatIndex, TeamId, Tile } from '../../shared/types';
import { socket } from '../lib/socket';
import {
  getSeatTeam,
  getTeamLabel,
  getTeamPerspective,
} from '../lib/teamPerspective';
import { DominoBoard } from './DominoBoard';
import { PlayerHand } from './PlayerHand';
import { ScoreModal } from './ScoreModal';
import { PartnerSwapModal } from './PartnerSwapModal';

export interface GameScreenProps {
  state: ClientGameState;
  playerId: string;
  soundMuted: boolean;
  onToggleMute: () => void;
}

interface SeatBadgeProps {
  player: Player | null;
  seat: SeatIndex;
  myTeam: TeamId;
  isTurn: boolean;
  justPassed: boolean;
  isPartner?: boolean;
  compact?: boolean;
}

function MiniTileStrip({ count }: { count: number }) {
  const capped = Math.max(0, Math.min(7, count));
  return (
    <div className="flex items-center gap-[2px]" aria-label={`${count} fichas`}>
      {Array.from({ length: capped }).map((_, idx) => (
        <span
          key={idx}
          className="inline-block w-[5px] h-[9px] rounded-[1.5px] bg-[#f5efe0] border border-stone-500/70 shadow-2xs"
        />
      ))}
    </div>
  );
}

function OpponentBadge({
  player,
  seat,
  myTeam,
  isTurn,
  justPassed,
  isPartner = false,
  compact = false,
}: SeatBadgeProps) {
  const team = getSeatTeam(seat);
  const isMyTeam = team === myTeam;

  const baseTone = isMyTeam
    ? 'border-sky-400/50 bg-sky-950/65'
    : 'border-orange-400/50 bg-emerald-950/70';

  const badgeDot = isMyTeam ? 'bg-sky-400' : 'bg-orange-400';

  return (
    <div className="relative flex flex-col items-center">
      {/* "Pasó" speech bubble */}
      {justPassed && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap px-2 py-0.5 rounded-full bg-amber-300 text-stone-950 text-[10px] font-extrabold shadow-md animate-tile-pop">
          ¡Pasó!
        </div>
      )}

      <div
        className={`rounded-xl border backdrop-blur-xs transition ${baseTone} ${
          isTurn
            ? 'ring-2 ring-amber-300 border-amber-300 animate-gold-pulse'
            : 'opacity-90'
        } ${compact ? 'px-1.5 py-1.5 w-[64px] sm:w-[86px]' : 'px-3 py-1 min-w-[155px] max-w-[230px]'}`}
      >
        <div
          className={`flex items-center ${
            compact ? 'flex-col gap-1 text-center' : 'justify-between gap-2.5'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0 max-w-full">
            <span className={`w-2 h-2 rounded-full shrink-0 ${badgeDot}`} />
            {player?.isBot && (
              <Bot className="w-3 h-3 text-emerald-300 shrink-0" />
            )}
            <span className="text-[11px] font-bold text-stone-50 truncate">
              {player?.name ?? `Asiento ${seat + 1}`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <MiniTileStrip count={player?.tileCount ?? 0} />
            <span className="text-[10px] font-extrabold text-amber-200 tabular-nums">
              {player?.tileCount ?? 0}
            </span>
          </div>
        </div>

        {isPartner && (
          <div className="text-[9px] font-bold uppercase tracking-wider text-sky-200/80 text-center leading-none mt-0.5">
            Tu Pareja · Nosotros
          </div>
        )}
      </div>
    </div>
  );
}

export function GameScreen({
  state,
  playerId,
  soundMuted,
  onToggleMute,
}: GameScreenProps) {
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [confirmLobbyOpen, setConfirmLobbyOpen] = useState(false);

  const baseSeat: SeatIndex = state.mySeat ?? 0;
  const partnerSeat = ((baseSeat + 2) % 4) as SeatIndex;
  const rightSeat = ((baseSeat + 1) % 4) as SeatIndex; // Next counter-clockwise
  const leftSeat = ((baseSeat + 3) % 4) as SeatIndex; // Previous player

  const isMyTurn =
    state.phase === 'playing' &&
    state.mySeat !== null &&
    state.currentTurn === state.mySeat;

  // Auto-open ScoreModal when hand or match ends
  useEffect(() => {
    if (state.phase === 'hand_over' || state.phase === 'match_over') {
      setScoreModalOpen(true);
      setSelectedTileId(null);
    } else if (state.phase === 'playing') {
      setScoreModalOpen(false);
      setSwapModalOpen(false);
    }
  }, [state.phase, state.handNumber]);

  // Clear selection if turn changes away or tile is no longer playable
  useEffect(() => {
    if (!isMyTurn) {
      setSelectedTileId(null);
      return;
    }
    if (
      selectedTileId &&
      !state.playableMoves.some((m) => m.tileId === selectedTileId)
    ) {
      setSelectedTileId(null);
    }
  }, [isMyTurn, selectedTileId, state.playableMoves]);

  const selectedTile: Tile | null = useMemo(
    () => state.myHand.find((t) => t.id === selectedTileId) ?? null,
    [state.myHand, selectedTileId]
  );

  const selectedSides = useMemo(() => {
    if (!selectedTileId) return [];
    return state.playableMoves.find((m) => m.tileId === selectedTileId)?.sides ?? [];
  }, [selectedTileId, state.playableMoves]);

  const handlePlayTile = (tileId: string, side: 'left' | 'right') => {
    socket.emit('game:play_tile', { tileId, side });
    setSelectedTileId(null);
  };

  const handleBoardPlaySide = (side: 'left' | 'right') => {
    if (!selectedTileId) return;
    handlePlayTile(selectedTileId, side);
  };

  const handlePass = () => {
    socket.emit('game:pass');
    setSelectedTileId(null);
  };

  const currentTurnPlayer =
    state.currentTurn !== null ? state.players[state.currentTurn] : null;

  const { myTeam, theirTeam } = getTeamPerspective(state.mySeat);

  const turnBannerText = useMemo(() => {
    if (state.phase === 'hand_over') {
      return 'Mano terminada — revisa la libreta';
    }
    if (state.phase === 'match_over') {
      const winnerLabel = state.matchWinner
        ? getTeamLabel(state.matchWinner, myTeam)
        : '';
      return `¡Partida terminada! Ganó ${winnerLabel}`;
    }
    if (isMyTurn) {
      return state.mustPlayDoubleSix
        ? 'Tu turno — juega la mula de 6'
        : 'Tu turno';
    }
    return `Turno de ${currentTurnPlayer?.name ?? '...'}`;
  }, [
    state.phase,
    state.matchWinner,
    state.mustPlayDoubleSix,
    myTeam,
    isMyTurn,
    currentTurnPlayer?.name,
  ]);

  const lastPassSeat =
    state.lastAction?.type === 'pass' ? state.lastAction.seat : null;

  return (
    <div className="h-[100dvh] w-full overflow-hidden flex flex-col felt-table select-none">
      {/* Compact Top Scoreboard Header */}
      <header className="mahogany-bar border-b border-amber-500/35 safe-top px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        {/* Live Team Scores + Meta */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-extrabold tabular-nums bg-sky-950/80 border-sky-400/55 text-sky-200">
            <span className="text-[10px]">Nosotros:</span>
            <span>{state.scores[myTeam]}</span>
          </div>

          <div className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-extrabold tabular-nums bg-emerald-950/85 border-orange-400/55 text-orange-200">
            <span className="text-[10px]">Ellos:</span>
            <span>{state.scores[theirTeam]}</span>
          </div>

          <span className="text-[11px] font-semibold text-amber-200/90 truncate">
            · Meta {state.settings.targetScore}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setScoreModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/35 hover:bg-black/50 border border-amber-400/30 text-amber-200 text-xs font-bold active:scale-95 transition cursor-pointer"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Libreta</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={soundMuted ? 'Activar sonido' : 'Silenciar sonido'}
            className="p-1.5 rounded-lg bg-black/35 hover:bg-black/50 border border-amber-400/25 text-amber-200 active:scale-95 transition cursor-pointer"
          >
            {soundMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setConfirmLobbyOpen(true)}
            aria-label="Volver al lobby"
            className="p-1.5 rounded-lg bg-black/35 hover:bg-black/50 border border-amber-400/25 text-stone-200 active:scale-95 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Subtle Turn Banner + Top Partner */}
      <div className="shrink-0 pt-1.5 px-2 flex flex-col items-center gap-1.5">
        <div
          className={`px-3 py-0.5 rounded-full text-[11px] font-bold tracking-wide border transition ${
            isMyTurn
              ? 'bg-amber-400 text-stone-950 border-amber-200 shadow-md'
              : 'bg-black/35 text-emerald-100/90 border-white/10'
          }`}
        >
          Mano #{state.handNumber} · {turnBannerText}
        </div>

        <OpponentBadge
          player={state.players[partnerSeat] ?? null}
          seat={partnerSeat}
          myTeam={myTeam}
          isTurn={state.phase === 'playing' && state.currentTurn === partnerSeat}
          justPassed={lastPassSeat === partnerSeat}
          isPartner
        />
      </div>

      {/* Middle Tabletop: Left Opponent | Center DominoBoard | Right Opponent */}
      <div className="flex-1 min-h-0 flex items-center justify-between gap-1 px-1.5 py-1 relative">
        <div className="shrink-0 flex items-center justify-center">
          <OpponentBadge
            player={state.players[leftSeat] ?? null}
            seat={leftSeat}
            myTeam={myTeam}
            isTurn={state.phase === 'playing' && state.currentTurn === leftSeat}
            justPassed={lastPassSeat === leftSeat}
            compact
          />
        </div>

        <div className="flex-1 min-w-0 h-full relative">
          <DominoBoard
            board={state.board}
            isMyTurn={isMyTurn}
            selectedTile={selectedTile}
            selectedSides={selectedSides}
            canPlayAny={state.playableMoves.length > 0}
            mustPlayDoubleSix={state.mustPlayDoubleSix}
            lastAction={state.lastAction}
            mySeat={state.mySeat}
            lastPlayerName={
              state.lastAction
                ? (state.players[state.lastAction.seat]?.name ?? null)
                : null
            }
            onPlaySide={handleBoardPlaySide}
          />

          {/* Quick reopen pill if hand/match ended and user minimized ScoreModal */}
          {(state.phase === 'hand_over' || state.phase === 'match_over') &&
            !scoreModalOpen && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30">
                <button
                  type="button"
                  onClick={() => setScoreModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-400 text-stone-950 font-extrabold text-xs shadow-xl animate-gold-pulse cursor-pointer"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>
                    {state.phase === 'match_over'
                      ? 'Ver Campeón y Revancha'
                      : 'Ver Resultado / Siguiente Mano'}
                  </span>
                </button>
              </div>
            )}
        </div>

        <div className="shrink-0 flex items-center justify-center">
          <OpponentBadge
            player={state.players[rightSeat] ?? null}
            seat={rightSeat}
            myTeam={myTeam}
            isTurn={state.phase === 'playing' && state.currentTurn === rightSeat}
            justPassed={lastPassSeat === rightSeat}
            compact
          />
        </div>
      </div>

      {/* Bottom Hand Tray */}
      <div className="shrink-0">
        <PlayerHand
          hand={state.myHand}
          playableMoves={state.playableMoves}
          isMyTurn={isMyTurn}
          boardEmpty={state.board.chain.length === 0}
          mustPlayDoubleSix={state.mustPlayDoubleSix}
          selectedTileId={selectedTileId}
          onSelectTile={(tile) => setSelectedTileId(tile?.id ?? null)}
          onPlayTile={handlePlayTile}
          onPass={handlePass}
          boardLeftEnd={state.board.leftEnd}
          boardRightEnd={state.board.rightEnd}
        />
      </div>

      {/* Score & Libreta Modal */}
      {scoreModalOpen && (
        <ScoreModal
          state={state}
          playerId={playerId}
          onClose={() => setScoreModalOpen(false)}
          onOpenPartnerSwap={() => {
            setScoreModalOpen(false);
            setSwapModalOpen(true);
          }}
        />
      )}

      {/* Partner Swap Modal between matches */}
      {swapModalOpen && (
        <PartnerSwapModal
          state={state}
          playerId={playerId}
          onClose={() => {
            setSwapModalOpen(false);
            setScoreModalOpen(true);
          }}
        />
      )}

      {/* Confirm Return to Lobby Dialog */}
      {confirmLobbyOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="mahogany-card rounded-2xl w-full max-w-xs p-4 space-y-3 text-center">
            <h3 className="font-display text-base font-extrabold text-amber-200">
              ¿Volver al Lobby?
            </h3>
            <p className="text-xs text-stone-200/85 leading-relaxed">
              La partida actual se reiniciará y todos los jugadores regresarán a la sala
              de espera.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmLobbyOpen(false)}
                className="py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs font-bold text-stone-200 active:scale-95 cursor-pointer"
              >
                Seguir jugando
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLobbyOpen(false);
                  socket.emit('game:return_to_lobby');
                }}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-extrabold text-white active:scale-95 cursor-pointer"
              >
                Ir al Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameScreen;
