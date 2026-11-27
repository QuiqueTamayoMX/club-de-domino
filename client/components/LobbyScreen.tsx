import { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Crown,
  Play,
  QrCode,
  RefreshCw,
  Share2,
  Shuffle,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { ClientGameState, Player, SeatIndex } from '../../shared/types';
import { socket } from '../lib/socket';
import {
  getTeamLabel,
  getTeamPerspective,
  isSameTeam,
} from '../lib/teamPerspective';

export interface LobbyScreenProps {
  state: ClientGameState;
  playerId: string;
  soundMuted: boolean;
  onToggleMute: () => void;
  onNotify: (payload: { type: 'info' | 'success' | 'error'; message: string }) => void;
}

const SEAT_META: Record<
  SeatIndex,
  { numberLabel: string; compass: string; team: 'A' | 'B' }
> = {
  0: { numberLabel: 'Asiento 1', compass: 'Sur', team: 'A' },
  1: { numberLabel: 'Asiento 2', compass: 'Este', team: 'B' },
  2: { numberLabel: 'Asiento 3', compass: 'Norte', team: 'A' },
  3: { numberLabel: 'Asiento 4', compass: 'Oeste', team: 'B' },
};

export function LobbyScreen({
  state,
  playerId,
  soundMuted,
  onToggleMute,
  onNotify,
}: LobbyScreenProps) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<SeatIndex | null>(null);

  const isHost = state.hostId === playerId;
  const { myTeam } = getTeamPerspective(state.mySeat);
  const filledCount = state.players.filter(Boolean).length;
  const canStart = filledCount === 4;
  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?sala=${state.roomCode}`
      : `?sala=${state.roomCode}`;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        const input = document.createElement('input');
        input.value = inviteUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      onNotify({ type: 'success', message: 'Enlace copiado para invitar' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify({ type: 'error', message: 'No se pudo copiar el enlace' });
    }
  };

  const handleShareWhatsApp = async () => {
    const shareText = `¡Vente al Dominó de Parejas! Entra a la mesa ${state.roomCode} aquí: ${inviteUrl}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Mesa ${state.roomCode} · Club de Dominó`,
          text: `¡Únete a mi mesa de Club de Dominó (${state.roomCode})!`,
          url: inviteUrl,
        });
        return;
      } catch {
        // User cancelled or Web Share unsupported for desktop -> fallback to wa.me
      }
    }
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSeatTap = (seat: SeatIndex) => {
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

  const renderSeatCard = (seat: SeatIndex, compactSide = false) => {
    const player: Player | null = state.players[seat] ?? null;
    const meta = SEAT_META[seat];
    const isMyTeam = isSameTeam(seat, myTeam);
    const teamLabel = getTeamLabel(meta.team, myTeam);
    const isSelected = selectedSeat === seat;
    const isMe = player?.id === playerId || seat === state.mySeat;
    const isSeatHost = Boolean(player && player.id === state.hostId);

    const teamBorder = isMyTeam
      ? 'border-sky-400/50 bg-sky-950/45'
      : 'border-orange-400/50 bg-emerald-950/55';
    const teamBadge = isMyTeam
      ? 'bg-sky-500/20 text-sky-200 border-sky-400/40'
      : 'bg-orange-500/20 text-orange-200 border-orange-400/40';

    return (
      <div
        key={seat}
        role="button"
        tabIndex={0}
        onClick={() => handleSeatTap(seat)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSeatTap(seat);
          }
        }}
        className={`relative rounded-xl border p-2.5 transition cursor-pointer select-none active:scale-[0.98] ${teamBorder} ${
          isSelected
            ? 'ring-2 ring-amber-300 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.45)]'
            : 'hover:border-amber-300/60'
        } ${compactSide ? 'min-h-[88px]' : 'min-h-[78px]'} flex flex-col justify-between`}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${teamBadge}`}
          >
            {teamLabel} · {meta.compass}
          </span>

          {player?.isBot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (selectedSeat === seat) setSelectedSeat(null);
                socket.emit('room:remove_bot', { seat });
              }}
              aria-label={`Quitar bot ${player.name}`}
              className="p-0.5 rounded-full bg-black/45 text-stone-300 hover:text-rose-300 hover:bg-rose-950/80 transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
          {player ? (
            <>
              {isSeatHost && (
                <Crown
                  className="w-3.5 h-3.5 text-amber-300 shrink-0"
                  aria-label="Anfitrión"
                />
              )}
              {player.isBot && (
                <Bot className="w-3.5 h-3.5 text-emerald-300 shrink-0" aria-label="Bot" />
              )}
              <span className="font-bold text-xs sm:text-sm text-stone-50 truncate">
                {player.name}
              </span>
              {isMe && (
                <span className="text-[10px] font-extrabold text-amber-300 shrink-0">
                  (Tú)
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-stone-300/70 italic">
              <UserPlus className="w-3.5 h-3.5" />
              Libre
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between text-[10px] text-stone-300/75">
          <span>{meta.numberLabel}</span>
          {player && !player.connected && !player.isBot && (
            <span className="text-rose-300 font-semibold">Desconectado</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col max-w-lg mx-auto px-3.5 py-3 safe-top safe-bottom gap-3">
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300/90">
            Sala de Espera
          </p>
          <h1 className="font-display text-lg font-extrabold text-stone-50 leading-tight">
            Mesa {state.roomCode} · {filledCount}/4
          </h1>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={soundMuted ? 'Activar sonido' : 'Silenciar sonido'}
          className="p-2.5 rounded-xl bg-black/30 border border-amber-400/25 text-amber-200 hover:bg-black/45 active:scale-95 transition cursor-pointer"
        >
          {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </header>

      {/* Frictionless Invite Card */}
      <section className="mahogany-card rounded-2xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200/80 block">
              Código de Mesa
            </span>
            <div className="font-display text-3xl font-black tracking-[0.22em] text-amber-300 leading-none mt-0.5">
              {state.roomCode}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/35 hover:bg-black/50 border border-amber-400/30 text-xs font-bold text-stone-100 active:scale-95 transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-amber-300" />
                  <span>Copiar Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              aria-expanded={showQr}
              className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border text-xs font-bold active:scale-95 transition cursor-pointer ${
                showQr
                  ? 'bg-amber-400 text-stone-950 border-amber-300'
                  : 'bg-black/35 hover:bg-black/50 border-amber-400/30 text-amber-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>QR</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleShareWhatsApp}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm shadow-md active:scale-[0.98] transition cursor-pointer"
        >
          <Share2 className="w-4 h-4" />
          <span>Compartir por WhatsApp</span>
        </button>

        {showQr && (
          <div className="pt-2 flex flex-col items-center gap-2 border-t border-amber-400/20">
            <div className="p-3 rounded-2xl bg-white shadow-lg">
              <QRCodeSVG value={inviteUrl} size={148} level="M" />
            </div>
            <p className="text-[11px] text-amber-100/80 text-center">
              Escanea con la cámara para entrar directo a la mesa
            </p>
          </div>
        )}
      </section>

      {/* 4-Seat Visual Diamond / Compass Table */}
      <section className="mahogany-card rounded-2xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-200">
              Mesa de Parejas
            </h2>
            <p className="text-[11px] text-stone-300/80">
              {selectedSeat !== null
                ? `Toca otro asiento para intercambiar con ${SEAT_META[selectedSeat].compass}`
                : 'Toca dos asientos para intercambiar jugadores'}
            </p>
          </div>
        </div>

        {/* Team Legend */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold">
          <div className="rounded-lg bg-sky-950/50 border border-sky-400/35 px-2.5 py-1.5 text-sky-200 text-center">
            Nosotros · {myTeam === 'A' ? 'Sur y Norte' : 'Este y Oeste'}
          </div>
          <div className="rounded-lg bg-emerald-950/60 border border-orange-400/35 px-2.5 py-1.5 text-orange-200 text-center">
            Ellos · {myTeam === 'A' ? 'Este y Oeste' : 'Sur y Norte'}
          </div>
        </div>

        {/* Compass Grid */}
        <div className="space-y-2">
          {/* North: Seat 2 (Asiento 3) */}
          <div className="max-w-[230px] mx-auto">{renderSeatCard(2)}</div>

          {/* West (Seat 3) + Center Felt Emblem + East (Seat 1) */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {renderSeatCard(3, true)}

            <div className="w-10 h-10 rounded-full bg-emerald-900/80 border border-amber-400/35 flex items-center justify-center shadow-inner">
              <span className="font-display text-[11px] font-extrabold text-amber-300">
                VS
              </span>
            </div>

            {renderSeatCard(1, true)}
          </div>

          {/* South: Seat 0 (Asiento 1) */}
          <div className="max-w-[230px] mx-auto">{renderSeatCard(0)}</div>
        </div>

        {/* Quick Partner & Bot Controls */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setSelectedSeat(null);
              socket.emit('room:rotate_partners');
            }}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-black/35 hover:bg-black/50 border border-amber-400/25 text-xs font-bold text-amber-100 active:scale-95 transition cursor-pointer"
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
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-black/35 hover:bg-black/50 border border-amber-400/25 text-xs font-bold text-amber-100 active:scale-95 transition cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5 text-amber-300" />
            <span>Al Azar</span>
          </button>
        </div>

        {filledCount < 4 && (
          <button
            type="button"
            onClick={() => {
              setSelectedSeat(null);
              socket.emit('room:fill_bots');
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-800/75 hover:bg-emerald-700/80 border border-emerald-400/40 text-xs font-bold text-emerald-50 active:scale-[0.98] transition cursor-pointer"
          >
            <Bot className="w-4 h-4 text-emerald-300" />
            <span>Llenar con Bots ({4 - filledCount} libres)</span>
          </button>
        )}
      </section>

      {/* Settings Section */}
      <section className="mahogany-card rounded-2xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-200">
            Reglas de la Mesa
          </h2>
          {!isHost && (
            <span className="text-[10px] text-stone-300/75">Solo anfitrión edita</span>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-stone-200">Meta de puntos</span>
          <div className="flex gap-1.5">
            {([100, 150, 200] as const).map((pts) => {
              const active = state.settings.targetScore === pts;
              return (
                <button
                  key={pts}
                  type="button"
                  disabled={!isHost}
                  onClick={() =>
                    socket.emit('room:update_settings', { targetScore: pts })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                    active
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'bg-black/35 text-stone-300 border border-white/10'
                  } ${isHost ? 'cursor-pointer active:scale-95' : 'opacity-80 cursor-default'}`}
                >
                  {pts}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scoring mode */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-stone-200 block">Puntuación</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { value: 'opponents_only', label: 'Solo rivales' },
                { value: 'all_remaining', label: 'Todas las fichas' },
              ] as const
            ).map((opt) => {
              const active = state.settings.scoringMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!isHost}
                  onClick={() =>
                    socket.emit('room:update_settings', { scoringMode: opt.value })
                  }
                  className={`py-2 px-2.5 rounded-lg text-xs font-bold transition ${
                    active
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'bg-black/35 text-stone-300 border border-white/10'
                  } ${isHost ? 'cursor-pointer active:scale-95' : 'opacity-80 cursor-default'}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Capicu toggle */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-stone-200 block">
            Capicú (+25 pts)
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { value: false, label: 'Desactivado' },
                { value: true, label: 'Activado' },
              ] as const
            ).map((opt) => {
              const active = state.settings.capicuBonus === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  disabled={!isHost}
                  onClick={() =>
                    socket.emit('room:update_settings', { capicuBonus: opt.value })
                  }
                  className={`py-2 px-2.5 rounded-lg text-xs font-bold transition ${
                    active
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'bg-black/35 text-stone-300 border border-white/10'
                  } ${isHost ? 'cursor-pointer active:scale-95' : 'opacity-80 cursor-default'}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Primary Start Match CTA */}
      <div className="pt-0.5 pb-2">
        <button
          type="button"
          disabled={!canStart}
          onClick={() => socket.emit('room:start_match')}
          className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-extrabold text-base transition ${
            canStart
              ? 'bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 shadow-[0_6px_24px_rgba(212,175,55,0.42)] active:scale-[0.98] cursor-pointer'
              : 'bg-stone-800/75 text-stone-400 border border-white/10 cursor-not-allowed'
          }`}
        >
          <Play className="w-5 h-5 fill-current" />
          <span>Iniciar Partida</span>
        </button>
        {!canStart && (
          <p className="text-center text-[11px] text-amber-200/80 mt-1.5">
            Se necesitan 4 jugadores para comenzar ({filledCount}/4)
          </p>
        )}
      </div>
    </div>
  );
}

export default LobbyScreen;
