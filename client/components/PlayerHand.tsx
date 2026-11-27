import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, Hand, X } from 'lucide-react';
import type { PlayableMove, Tile } from '../../shared/types';
import { DominoTile } from './DominoTile';

export interface PlayerHandProps {
  hand: Tile[];
  playableMoves: PlayableMove[];
  isMyTurn: boolean;
  boardEmpty: boolean;
  mustPlayDoubleSix: boolean;
  selectedTileId: string | null;
  onSelectTile: (tile: Tile | null) => void;
  onPlayTile: (tileId: string, side: 'left' | 'right') => void;
  onPass: () => void;
  boardLeftEnd: number | null;
  boardRightEnd: number | null;
}

export function PlayerHand({
  hand,
  playableMoves,
  isMyTurn,
  boardEmpty,
  mustPlayDoubleSix,
  selectedTileId,
  onSelectTile,
  onPlayTile,
  onPass,
  boardLeftEnd,
  boardRightEnd,
}: PlayerHandProps) {
  const playableMap = useMemo(() => {
    const map = new Map<string, ('left' | 'right')[]>();
    for (const m of playableMoves) {
      map.set(m.tileId, m.sides);
    }
    return map;
  }, [playableMoves]);

  const selectedSides = selectedTileId ? playableMap.get(selectedTileId) ?? [] : [];
  const mustPass = isMyTurn && playableMoves.length === 0;

  const handleTileTap = (tile: Tile) => {
    if (!isMyTurn) return;
    const sides = playableMap.get(tile.id);
    if (!sides || sides.length === 0) return;

    if (selectedTileId === tile.id) {
      // Second tap on selected tile: play immediately when unambiguous
      if (boardEmpty || sides.length === 1) {
        onPlayTile(tile.id, sides[0]);
        onSelectTile(null);
      } else {
        onSelectTile(null);
      }
      return;
    }

    onSelectTile(tile);
  };

  const handlePlaySide = (side: 'left' | 'right') => {
    if (!selectedTileId) return;
    onPlayTile(selectedTileId, side);
    onSelectTile(null);
  };

  return (
    <div className="relative w-full mahogany-bar border-t border-amber-500/35 safe-bottom px-2 pt-2 pb-2.5 select-none">
      {/* Contextual thumb-friendly action bar right above tiles */}
      <div className="min-h-[38px] flex items-center justify-center mb-1.5 px-1">
        {mustPass ? (
          <button
            type="button"
            onClick={onPass}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 font-extrabold text-sm shadow-[0_4px_14px_rgba(212,175,55,0.45)] active:scale-95 transition-transform cursor-pointer animate-gold-pulse"
          >
            <Hand className="w-4 h-4" />
            <span>Tocar / Pasar</span>
          </button>
        ) : isMyTurn && selectedTileId && selectedSides.length === 2 && !boardEmpty ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePlaySide('left')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-400 text-stone-950 font-bold text-xs shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Izquierda ({boardLeftEnd})</span>
            </button>
            <button
              type="button"
              onClick={() => handlePlaySide('right')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-400 text-stone-950 font-bold text-xs shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              <span>Derecha ({boardRightEnd})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onSelectTile(null)}
              aria-label="Deseleccionar ficha"
              className="p-1.5 rounded-full bg-black/35 text-stone-300 hover:text-white active:scale-95 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : isMyTurn && selectedTileId && selectedSides.length >= 1 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePlaySide(selectedSides[0])}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-amber-400 text-stone-950 font-bold text-xs shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              <span>
                {boardEmpty
                  ? 'Colocar en la mesa'
                  : `Jugar en ${selectedSides[0] === 'left' ? `Izquierda (${boardLeftEnd})` : `Derecha (${boardRightEnd})`}`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTile(null)}
              aria-label="Cancelar selección"
              className="p-1.5 rounded-full bg-black/35 text-stone-300 hover:text-white active:scale-95 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : isMyTurn ? (
          <p className="text-xs font-semibold text-amber-200/95 tracking-wide">
            {mustPlayDoubleSix
              ? 'Toca la Mula de 6 (6-6) para abrir'
              : 'Toca una ficha iluminada para jugar'}
          </p>
        ) : (
          <p className="text-xs text-stone-300/75">Esperando jugada...</p>
        )}
      </div>

      {/* Player's tiles */}
      <div className="flex items-end justify-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar pt-3 pb-1 px-1">
        {hand.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-xs text-amber-200/80 font-medium">
            ¡Sin fichas!
          </div>
        ) : (
          hand.map((tile) => {
            const sides = playableMap.get(tile.id);
            const isPlayable = isMyTurn && Boolean(sides && sides.length > 0);
            const isSelected = isMyTurn && selectedTileId === tile.id;
            const isDimmed = isMyTurn && playableMoves.length > 0 && !isPlayable;

            return (
              <div key={tile.id} className="shrink-0">
                <DominoTile
                  tile={tile}
                  orientation="vertical"
                  size="md"
                  selected={isSelected}
                  playable={isPlayable}
                  disabled={isDimmed}
                  onClick={isPlayable ? () => handleTileTap(tile) : undefined}
                  ariaLabel={`Ficha ${tile.a}-${tile.b}${isPlayable ? ' (jugable)' : ''}`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default PlayerHand;
