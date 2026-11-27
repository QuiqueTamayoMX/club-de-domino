import { useState } from 'react';
import { Bot, Play, RefreshCw, Shuffle, Users, X } from 'lucide-react';
import type { ClientGameState, SeatIndex } from '../../shared/types';
import { socket } from '../lib/socket';
import {
  getTeamLabel,
  getTeamPerspective,
  isSameTeam,
} from '../lib/teamPerspective';

export interface PartnerSwapModalProps {
  state: ClientGameState;
  playerId: string;
  onClose: () => void;
}

const SEAT_LABELS: Record<SeatIndex, { compass: string; team: 'A' | 'B' }> = {
  0: { compass: 'Sur', team: 'A' },
  1: { compass: 'Este', team: 'B' },
  2: { compass: 'Norte', team: 'A' },
  3: { compass: 'Oeste', team: 'B' },
};

export function PartnerSwapModal({
  state,
  playerId,
  onClose,
}: PartnerSwapModalProps) {
  const [selectedSeat, setSelectedSeat] = useState<SeatIndex | null>(null);
  const { myTeam } = getTeamPerspective(state.mySeat);

  const handleTapSeat = (seat: SeatIndex) => {
    if (selectedSeat === null) {
      setSelectedSeat(seat);
      return;
    }
    if (selectedSeat === seat) {
      setSelectedSeat(null);
      return;
    }
    socket.emit('room:swap_two_seats', { seatA: selectedSeat, seatB: seat });
    setSelectedSeat(null);
  };

  const renderSeatButton = (seat: SeatIndex) => {
    const player = state.players[seat];
    const info = SEAT_LABELS[seat];
    const isMyTeam = isSameTeam(seat, myTeam);
    const teamLabel = getTeamLabel(info.team, myTeam);
    const isSelected = selectedSeat === seat;
    const isMe = player?.id === playerId;

    return (
      <button
        key={seat}
        type="button"
        onClick={() => handleTapSeat(seat)}
        className={`rounded-xl border p-2.5 text-left transition active:scale-[0.98] cursor-pointer ${
          isMyTeam
            ? 'bg-sky-950/50 border-sky-400/45'
            : 'bg-emerald-950/60 border-orange-400/45'
        } ${
          isSelected
            ? 'ring-2 ring-amber-300 border-amber-300 shadow-lg'
            : 'hover:border-amber-300/60'
        }`}
      >
        <div className="flex items-center justify-between text-[10px] font-bold">
          <span className={isMyTeam ? 'text-sky-200' : 'text-orange-200'}>
            {teamLabel} · {info.compass}
          </span>
          {player?.isBot && <Bot className="w-3 h-3 text-emerald-300" />}
        </div>
        <div className="mt-1 text-xs sm:text-sm font-bold text-stone-50 truncate">
          {player?.name ?? `Asiento ${seat + 1}`}
          {isMe ? ' (Tú)' : ''}
        </div>
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cambiar Parejas"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4 safe-bottom"
    >
      <div className="mahogany-card rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-amber-400/25">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-300" />
            <h2 className="font-display text-base font-extrabold text-amber-200">
              Cambiar Parejas
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg bg-black/35 text-stone-300 hover:text-white active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          <p className="text-xs text-stone-200/85 text-center">
            {selectedSeat !== null
              ? `Toca otro jugador para intercambiar con ${SEAT_LABELS[selectedSeat].compass}`
              : 'Toca 2 jugadores para intercambiar asientos o usa un botón rápido'}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-center text-sky-200">
                Nosotros ({myTeam === 'A' ? 'Sur / Norte' : 'Este / Oeste'})
              </div>
              {renderSeatButton(myTeam === 'A' ? 0 : 1)}
              {renderSeatButton(myTeam === 'A' ? 2 : 3)}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-bold text-center text-orange-200">
                Ellos ({myTeam === 'A' ? 'Este / Oeste' : 'Sur / Norte'})
              </div>
              {renderSeatButton(myTeam === 'A' ? 1 : 0)}
              {renderSeatButton(myTeam === 'A' ? 3 : 2)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedSeat(null);
                socket.emit('room:rotate_partners');
              }}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-black/35 hover:bg-black/50 border border-amber-400/30 text-xs font-bold text-amber-100 active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-300" />
              <span>Rotar Parejas</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedSeat(null);
                socket.emit('room:randomize_partners');
              }}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-black/35 hover:bg-black/50 border border-amber-400/30 text-xs font-bold text-amber-100 active:scale-95 cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5 text-amber-300" />
              <span>Parejas al Azar</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              socket.emit('game:rematch');
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 font-extrabold text-sm shadow-lg active:scale-[0.98] cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Jugar Revancha</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default PartnerSwapModal;
