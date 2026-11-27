import {
  ArrowRight,
  ClipboardList,
  Home,
  RotateCcw,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { ClientGameState, SeatIndex, Tile } from '../../shared/types';
import { socket } from '../lib/socket';
import {
  getTeamLabel,
  getTeamPerspective,
  isSameTeam,
} from '../lib/teamPerspective';
import { DominoTile } from './DominoTile';

export interface ScoreModalProps {
  state: ClientGameState;
  playerId: string;
  onClose: () => void;
  onOpenPartnerSwap: () => void;
}

const SEATS: SeatIndex[] = [0, 1, 2, 3];

function sumPips(tiles: Tile[]): number {
  return tiles.reduce((acc, t) => acc + t.a + t.b, 0);
}

function getReasonLabel(reason: 'domino' | 'trancado' | 'trancado_tie'): string {
  switch (reason) {
    case 'domino':
      return '¡Dominó!';
    case 'trancado':
      return 'Juego Cerrado';
    case 'trancado_tie':
      return 'Empate en Juego Cerrado';
  }
}

export function ScoreModal({
  state,
  playerId,
  onClose,
  onOpenPartnerSwap,
}: ScoreModalProps) {
  const isHandOver = state.phase === 'hand_over';
  const isMatchOver = state.phase === 'match_over';
  const result = state.lastHandResult;
  const { myTeam, theirTeam } = getTeamPerspective(state.mySeat);

  const teamANames = [state.players[0]?.name, state.players[2]?.name]
    .filter(Boolean)
    .join(' y ');
  const teamBNames = [state.players[1]?.name, state.players[3]?.name]
    .filter(Boolean)
    .join(' y ');
  const ourNames = myTeam === 'A' ? teamANames : teamBNames;
  const theirNames = theirTeam === 'A' ? teamANames : teamBNames;

  const winnerPlayer =
    result && result.winnerSeat !== null ? state.players[result.winnerSeat] : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Libreta de Puntuación"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4 safe-bottom"
    >
      <div className="mahogany-card rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-amber-400/25 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-300" />
            <h2 className="font-display text-base font-extrabold text-amber-200">
              Libreta a {state.settings.targetScore}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar libreta"
            className="p-1.5 rounded-lg bg-black/35 text-stone-300 hover:text-white active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Match Over Trophy Celebration */}
          {isMatchOver && state.matchWinner && (
            <div className="rounded-2xl bg-gradient-to-b from-amber-500/25 to-amber-900/20 border border-amber-300/60 p-4 text-center space-y-1.5 shadow-lg">
              <div className="w-11 h-11 rounded-full bg-amber-400/20 border border-amber-300/60 flex items-center justify-center mx-auto">
                <Trophy className="w-6 h-6 text-amber-300" />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                ¡Campeones de la Mesa!
              </p>
              <h3 className="font-display text-xl font-black text-stone-50">
                {getTeamLabel(state.matchWinner, myTeam)}
              </h3>
              <p className="text-xs font-semibold text-amber-100/90">
                {state.matchWinner === myTeam ? ourNames : theirNames}
              </p>
              <p className="text-xs font-bold text-emerald-200 pt-0.5">
                Marcador final: Nosotros {state.scores[myTeam]} — Ellos{' '}
                {state.scores[theirTeam]}
              </p>
            </div>
          )}

          {/* Hand Result Banner + Remaining Tiles */}
          {(isHandOver || isMatchOver) && result && (
            <div className="space-y-2.5">
              <div className="rounded-xl bg-black/30 border border-amber-400/25 p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      Mano #{result.handNumber}
                    </span>
                    {result.isCapicu && (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-amber-400 text-stone-950 text-[10px] font-extrabold uppercase tracking-wide">
                        ¡Capicú! +25
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-extrabold text-stone-50 leading-tight">
                    {getReasonLabel(result.reason)}
                  </h3>
                  {result.winnerTeam ? (
                    <p className="text-xs text-emerald-200/90 mt-0.5">
                      Gana{' '}
                      <strong className="text-amber-300">
                        {getTeamLabel(result.winnerTeam, myTeam)}
                      </strong>
                      {winnerPlayer ? ` (${winnerPlayer.name})` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-stone-300 mt-0.5">
                      Sin puntos otorgados en esta mano
                    </p>
                  )}
                  {(result.reason === 'trancado' || result.reason === 'trancado_tie') && (
                    <p className="text-[11px] text-amber-100/80 mt-0.5 tabular-nums">
                      Nosotros: {result.teamPipTotals[myTeam]} pts · Ellos:{' '}
                      {result.teamPipTotals[theirTeam]} pts
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="px-3 py-1.5 rounded-xl bg-amber-400/15 border border-amber-400/40">
                    <span className="font-display text-lg font-black text-amber-300">
                      +{result.pointsAwarded}
                    </span>
                    <span className="block text-[10px] font-bold text-amber-200/80 uppercase">
                      puntos
                    </span>
                  </div>
                </div>
              </div>

              {/* Reveal all 4 players' remaining tiles */}
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                  Fichas restantes en mano
                </h4>
                <div className="grid grid-cols-1 gap-1.5">
                  {SEATS.map((seat) => {
                    const player = state.players[seat];
                    const tiles = result.remainingHands[seat] ?? [];
                    const pips = sumPips(tiles);
                    const isMyTeam = isSameTeam(seat, myTeam);
                    const isMe = player?.id === playerId;

                    return (
                      <div
                        key={seat}
                        className={`rounded-xl border px-2.5 py-2 flex flex-col gap-1.5 ${
                          isMyTeam
                            ? 'bg-sky-950/35 border-sky-400/30'
                            : 'bg-emerald-950/45 border-orange-400/30'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 font-bold text-stone-100">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold ${
                                isMyTeam
                                  ? 'bg-sky-500/25 text-sky-200'
                                  : 'bg-orange-500/25 text-orange-200'
                              }`}
                            >
                              {isMyTeam ? 'Nosotros' : 'Ellos'}
                            </span>
                            <span>
                              {player?.name ?? `Asiento ${seat + 1}`}
                              {isMe ? ' (Tú)' : ''}
                            </span>
                          </div>
                          <span className="text-[11px] font-extrabold text-amber-300 tabular-nums">
                            {tiles.length === 0 ? '¡Dominó! (0 pts)' : `${pips} pts`}
                          </span>
                        </div>

                        {tiles.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            {tiles.map((tile) => (
                              <DominoTile
                                key={tile.id}
                                tile={tile}
                                orientation="vertical"
                                size="xs"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Full Libreta Table */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold uppercase tracking-wider text-amber-200">
                Historial de Manos
              </span>
              <span className="text-stone-300/80">
                Meta: {state.settings.targetScore} pts ·{' '}
                {state.settings.scoringMode === 'all_remaining'
                  ? 'Todas las fichas'
                  : 'Solo rivales'}
                {state.settings.capicuBonus ? ' · Capicú +25' : ''}
              </span>
            </div>

            <div className="rounded-xl overflow-hidden border border-amber-400/25 bg-black/30">
              <table className="w-full text-xs text-center border-collapse">
                <thead>
                  <tr className="bg-black/45 text-[11px] text-amber-200 border-b border-amber-400/20">
                    <th className="py-2 px-2 font-bold">Mano</th>
                    <th className="py-2 px-2 font-bold text-sky-200">Nosotros</th>
                    <th className="py-2 px-2 font-bold text-orange-200">Ellos</th>
                    <th className="py-2 px-2 font-bold">Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {state.history.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-stone-400 text-xs">
                        Aún no concluye la primera mano
                      </td>
                    </tr>
                  ) : (
                    state.history.map((hand) => {
                      const ptsUs =
                        hand.winnerTeam === myTeam ? hand.pointsAwarded : 0;
                      const ptsThem =
                        hand.winnerTeam === theirTeam ? hand.pointsAwarded : 0;
                      return (
                        <tr
                          key={hand.handNumber}
                          className="border-b border-white/5 last:border-none"
                        >
                          <td className="py-2 px-2 font-bold text-stone-200">
                            #{hand.handNumber}
                          </td>
                          <td className="py-2 px-2 font-bold text-sky-200 tabular-nums">
                            {ptsUs > 0 ? `+${ptsUs}` : '—'}
                          </td>
                          <td className="py-2 px-2 font-bold text-orange-200 tabular-nums">
                            {ptsThem > 0 ? `+${ptsThem}` : '—'}
                          </td>
                          <td className="py-2 px-2 font-extrabold text-amber-200 tabular-nums">
                            {hand.cumulativeScores[myTeam]} –{' '}
                            {hand.cumulativeScores[theirTeam]}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-400/10 border-t border-amber-400/25 font-extrabold">
                    <td className="py-2 px-2 text-amber-200">Total</td>
                    <td className="py-2 px-2 text-sky-300 tabular-nums">
                      {state.scores[myTeam]}
                    </td>
                    <td className="py-2 px-2 text-orange-300 tabular-nums">
                      {state.scores[theirTeam]}
                    </td>
                    <td className="py-2 px-2 text-amber-300 tabular-nums">
                      / {state.settings.targetScore}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-amber-400/25 bg-black/25 shrink-0 space-y-2">
          {isHandOver && (
            <button
              type="button"
              onClick={() => socket.emit('game:next_hand')}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 font-extrabold text-sm shadow-lg active:scale-[0.98] cursor-pointer"
            >
              <span>Siguiente Mano</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {isMatchOver && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => socket.emit('game:rematch')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 font-extrabold text-sm shadow-lg active:scale-[0.98] cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Revancha (Mismas Parejas)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onOpenPartnerSwap}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-800/75 hover:bg-emerald-700/80 border border-emerald-400/40 text-xs font-bold text-white active:scale-95 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Cambiar Parejas</span>
                </button>

                <button
                  type="button"
                  onClick={() => socket.emit('game:return_to_lobby')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-black/40 hover:bg-black/55 border border-amber-400/30 text-xs font-bold text-amber-100 active:scale-95 cursor-pointer"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>Volver al Lobby</span>
                </button>
              </div>
            </div>
          )}

          {!isHandOver && !isMatchOver && (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-amber-400 text-stone-950 font-extrabold text-sm active:scale-[0.98] cursor-pointer"
            >
              Volver a la mesa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScoreModal;
