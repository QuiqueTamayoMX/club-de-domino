import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BoardState, LastAction, PlacedTile, SeatIndex, Tile } from '../../shared/types';
import { DominoTile } from './DominoTile';

export interface DominoBoardProps {
  board: BoardState;
  isMyTurn: boolean;
  selectedTile: Tile | null;
  selectedSides: ('left' | 'right')[];
  canPlayAny?: boolean;
  mustPlayDoubleSix?: boolean;
  lastAction?: LastAction | null;
  mySeat?: SeatIndex | null;
  lastPlayerName?: string | null;
  onPlaySide: (side: 'left' | 'right') => void;
}

interface PositionedTile {
  key: string;
  placed: PlacedTile;
  cx: number;
  cy: number;
  width: number;
  height: number;
  orientation: 'horizontal' | 'vertical';
  firstValue: number;
  secondValue: number;
}

interface DropPoint {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

// Base virtual unit matching DominoTile size="sm" (32x64 vertical, 64x32 horizontal)
const U = 32;
const GAP = 3;
const DROP_W = 46;
const DROP_H = 34;

function computeSnakeLayout(
  chain: PlacedTile[],
  availableWidth: number,
  availableHeight: number
): {
  items: PositionedTile[];
  leftDrop: DropPoint;
  rightDrop: DropPoint;
  stageWidth: number;
  stageHeight: number;
  scale: number;
} {
  const n = chain.length;
  const aspect = Math.max(0.75, Math.min(1.45, availableWidth / Math.max(180, availableHeight)));
  const rowWrapWidth = Math.max(240, Math.min(430, Math.sqrt(Math.max(4, n) * 60 * 74 * aspect)));

  const items: PositionedTile[] = [];
  let dir: 1 | -1 = 1;
  let rowY = 0;
  let cursorX = 0; // leading attachment X for next horizontal-row tile
  let prevBottomY = U / 2;

  for (let i = 0; i < n; i++) {
    const placed = chain[i];
    const isDouble = placed.isDouble;
    const tileRunWidth = isDouble ? U : U * 2;
    const tileHeight = isDouble ? U * 2 : U;

    // Check if placing along current horizontal row would exceed wrap bounds (never wrap on tile 0)
    const wouldExceedRight = dir === 1 && i > 0 && cursorX + tileRunWidth > rowWrapWidth;
    const wouldExceedLeft = dir === -1 && i > 0 && cursorX - tileRunWidth < 0;

    if (wouldExceedRight || wouldExceedLeft) {
      // L-bend downward using this tile vertically
      const prev = items[items.length - 1];
      const prevOuterX = dir === 1 ? prev.cx + prev.width / 2 : prev.cx - prev.width / 2;
      const turnCx = prevOuterX - dir * (U / 2);
      const turnCy = prevBottomY + GAP + U + 3;

      items.push({
        key: placed.tile.id,
        placed,
        cx: turnCx,
        cy: turnCy,
        width: U,
        height: U * 2,
        orientation: 'vertical',
        firstValue: placed.leftValue,
        secondValue: placed.rightValue,
      });

      // Flip horizontal direction starting from bottom half of the vertical turn tile
      dir = dir === 1 ? -1 : 1;
      rowY = turnCy + U / 2;
      cursorX = turnCx + dir * (U / 2 + GAP);
      prevBottomY = turnCy + U;
      continue;
    }

    const cx = cursorX + dir * (tileRunWidth / 2);
    const cy = rowY;
    const orientation: 'horizontal' | 'vertical' = isDouble ? 'vertical' : 'horizontal';

    // When moving Right-to-Left, leftValue faces the previous tile (on the right)
    const firstValue = dir === 1 || isDouble ? placed.leftValue : placed.rightValue;
    const secondValue = dir === 1 || isDouble ? placed.rightValue : placed.leftValue;

    items.push({
      key: placed.tile.id,
      placed,
      cx,
      cy,
      width: tileRunWidth,
      height: tileHeight,
      orientation,
      firstValue,
      secondValue,
    });

    cursorX = cursorX + dir * (tileRunWidth + GAP);
    prevBottomY = Math.max(rowY + tileHeight / 2, cy + tileHeight / 2);
  }

  // Left drop attaches before chain[0] (Row 0 always starts going dir=+1 at x=0, y=0)
  const firstItem = items[0];
  const leftDrop: DropPoint = {
    cx: firstItem ? firstItem.cx - firstItem.width / 2 - GAP - DROP_W / 2 : -DROP_W / 2,
    cy: firstItem ? firstItem.cy : 0,
    width: DROP_W,
    height: DROP_H,
  };

  // Right drop attaches after chain[n-1]
  const lastItem = items[items.length - 1];
  let rightDrop: DropPoint;
  if (!lastItem) {
    rightDrop = { cx: DROP_W / 2, cy: 0, width: DROP_W, height: DROP_H };
  } else {
    // Check if the last item was a vertical L-bend turn (non-double rendered vertical)
    const lastWasTurn = !lastItem.placed.isDouble && lastItem.orientation === 'vertical';
    if (lastWasTurn) {
      rightDrop = {
        cx: lastItem.cx + dir * (U / 2 + GAP + DROP_W / 2),
        cy: rowY,
        width: DROP_W,
        height: DROP_H,
      };
    } else {
      rightDrop = {
        cx: lastItem.cx + dir * (lastItem.width / 2 + GAP + DROP_W / 2),
        cy: lastItem.cy,
        width: DROP_W,
        height: DROP_H,
      };
    }
  }

  // Compute tight bounding box including drop zones so nothing ever clips
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const includeRect = (cx: number, cy: number, w: number, h: number) => {
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
  };

  for (const item of items) {
    includeRect(item.cx, item.cy, item.width, item.height);
  }
  includeRect(leftDrop.cx, leftDrop.cy, leftDrop.width, leftDrop.height);
  includeRect(rightDrop.cx, rightDrop.cy, rightDrop.width, rightDrop.height);

  const PAD = 10;
  const shiftX = -minX + PAD;
  const shiftY = -minY + PAD;

  const shiftedItems = items.map((item) => ({
    ...item,
    cx: item.cx + shiftX,
    cy: item.cy + shiftY,
  }));

  const shiftedLeftDrop: DropPoint = {
    ...leftDrop,
    cx: leftDrop.cx + shiftX,
    cy: leftDrop.cy + shiftY,
  };
  const shiftedRightDrop: DropPoint = {
    ...rightDrop,
    cx: rightDrop.cx + shiftX,
    cy: rightDrop.cy + shiftY,
  };

  const stageWidth = Math.max(1, maxX - minX + PAD * 2);
  const stageHeight = Math.max(1, maxY - minY + PAD * 2);

  const scaleX = Math.max(120, availableWidth - 8) / stageWidth;
  const scaleY = Math.max(120, availableHeight - 8) / stageHeight;
  const scale = Math.min(1.16, scaleX, scaleY);

  return {
    items: shiftedItems,
    leftDrop: shiftedLeftDrop,
    rightDrop: shiftedRightDrop,
    stageWidth,
    stageHeight,
    scale,
  };
}

export function DominoBoard({
  board,
  isMyTurn,
  selectedTile,
  selectedSides,
  canPlayAny = false,
  mustPlayDoubleSix = false,
  lastAction = null,
  mySeat = null,
  lastPlayerName = null,
  onPlaySide,
}: DominoBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState({ width: 320, height: 320 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoxSize({ width: rect.width, height: rect.height });
      }
    };
    update();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const layout = useMemo(
    () => computeSnakeLayout(board.chain, boxSize.width, boxSize.height),
    [board.chain, boxSize.width, boxSize.height]
  );

  const showLeftTarget = isMyTurn && selectedTile !== null && selectedSides.includes('left');
  const showRightTarget = isMyTurn && selectedTile !== null && selectedSides.includes('right');
  const lastPlayedTileId = lastAction?.type === 'play' ? lastAction.tile?.id : undefined;

  const throwOriginStyle = useMemo((): CSSProperties | undefined => {
    if (lastAction?.type !== 'play') return undefined;
    const rel = ((lastAction.seat - (mySeat ?? 0)) + 4) % 4;
    if (rel === 0) {
      return { '--throw-x': '0px', '--throw-y': '140px', '--throw-rot': '-6deg' } as CSSProperties;
    }
    if (rel === 1) {
      return { '--throw-x': '150px', '--throw-y': '0px', '--throw-rot': '8deg' } as CSSProperties;
    }
    if (rel === 2) {
      return { '--throw-x': '0px', '--throw-y': '-140px', '--throw-rot': '6deg' } as CSSProperties;
    }
    return { '--throw-x': '-150px', '--throw-y': '0px', '--throw-rot': '-8deg' } as CSSProperties;
  }, [lastAction, mySeat]);

  if (board.chain.length === 0) {
    const canPlaceEmpty = isMyTurn && selectedTile !== null && selectedSides.length > 0;
    return (
      <div
        ref={containerRef}
        className="relative w-full h-full flex flex-col items-center justify-center p-3 overflow-hidden select-none"
      >
        {/* Subtle felt center medallion */}
        <div className="relative flex flex-col items-center justify-center rounded-2xl border border-amber-400/20 bg-emerald-950/35 px-5 py-6 text-center shadow-inner max-w-[260px]">
          <div className="w-10 h-10 rounded-full border border-amber-400/35 bg-amber-500/10 flex items-center justify-center mb-2.5">
            <span className="font-display text-sm font-bold text-amber-300">6·6</span>
          </div>

          {canPlaceEmpty ? (
            <button
              type="button"
              onClick={() => onPlaySide('left')}
              className="px-5 py-3 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 font-bold text-sm shadow-lg animate-gold-pulse active:scale-95 transition-transform cursor-pointer"
            >
              Colocar ficha aquí
            </button>
          ) : isMyTurn ? (
            <>
              <p className="text-sm font-semibold text-amber-200">
                {mustPlayDoubleSix ? '¡Te toca abrir con la Mula de 6!' : 'Tu turno para abrir la mano'}
              </p>
              <p className="text-xs text-emerald-200/75 mt-1">
                {canPlayAny
                  ? 'Toca la ficha iluminada abajo para colocarla'
                  : 'Selecciona una ficha de tu mano'}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-emerald-100/90">Mesa lista</p>
              <p className="text-xs text-emerald-200/65 mt-1">
                Esperando la primera ficha de la mano...
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const scaledW = Math.round(layout.stageWidth * layout.scale);
  const scaledH = Math.round(layout.stageHeight * layout.scale);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden select-none"
    >
      {/* Subtle end badges at top corners of board for quick glance */}
      {board.leftEnd !== null && board.rightEnd !== null && (
        <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/35 border border-amber-400/20 backdrop-blur-xs text-[11px] font-medium text-emerald-100/90">
          <span>
            Izq: <strong className="text-amber-300 font-display">{board.leftEnd}</strong>
          </span>
          <span className="text-white/30">•</span>
          <span>
            Der: <strong className="text-amber-300 font-display">{board.rightEnd}</strong>
          </span>
        </div>
      )}

      {/* Exact scaled bounding wrapper prevents any horizontal or vertical overflow */}
      <div
        className="relative shrink-0"
        style={{
          width: `${scaledW}px`,
          height: `${scaledH}px`,
        }}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: `${layout.stageWidth}px`,
            height: `${layout.stageHeight}px`,
            transform: `scale(${layout.scale})`,
          }}
        >
          {layout.items.map((item) => {
            const isJustPlayed = lastPlayedTileId === item.placed.tile.id;
            return (
              <div
                key={item.key}
                className={`absolute ${isJustPlayed ? 'z-20 animate-tile-throw' : ''}`}
                style={{
                  left: `${item.cx - item.width / 2}px`,
                  top: `${item.cy - item.height / 2}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                  ...(isJustPlayed ? throwOriginStyle : undefined),
                }}
              >
                <DominoTile
                  tile={item.placed.tile}
                  leftValue={item.firstValue}
                  rightValue={item.secondValue}
                  orientation={item.orientation}
                  size="sm"
                  lastPlayed={isJustPlayed}
                />
              </div>
            );
          })}

          {/* Left end drop zone / subtle end marker */}
          {showLeftTarget ? (
            <button
              type="button"
              onClick={() => onPlaySide('left')}
              aria-label={`Colocar a la izquierda (${board.leftEnd})`}
              className="absolute z-20 flex items-center justify-center rounded-lg border-2 border-amber-300 bg-amber-400/25 text-amber-100 font-bold text-[11px] shadow-lg animate-gold-pulse cursor-pointer active:scale-95 transition-transform"
              style={{
                left: `${layout.leftDrop.cx - layout.leftDrop.width / 2}px`,
                top: `${layout.leftDrop.cy - layout.leftDrop.height / 2}px`,
                width: `${layout.leftDrop.width}px`,
                height: `${layout.leftDrop.height}px`,
              }}
            >
              Izq ({board.leftEnd})
            </button>
          ) : (
            <div
              className="pointer-events-none absolute flex items-center justify-center"
              style={{
                left: `${layout.leftDrop.cx - layout.leftDrop.width / 2}px`,
                top: `${layout.leftDrop.cy - layout.leftDrop.height / 2}px`,
                width: `${layout.leftDrop.width}px`,
                height: `${layout.leftDrop.height}px`,
              }}
            >
              <span className="px-1.5 py-0.5 rounded bg-black/35 border border-white/10 text-[10px] font-display text-emerald-200/75">
                {board.leftEnd}
              </span>
            </div>
          )}

          {/* Right end drop zone / subtle end marker */}
          {showRightTarget ? (
            <button
              type="button"
              onClick={() => onPlaySide('right')}
              aria-label={`Colocar a la derecha (${board.rightEnd})`}
              className="absolute z-20 flex items-center justify-center rounded-lg border-2 border-amber-300 bg-amber-400/25 text-amber-100 font-bold text-[11px] shadow-lg animate-gold-pulse cursor-pointer active:scale-95 transition-transform"
              style={{
                left: `${layout.rightDrop.cx - layout.rightDrop.width / 2}px`,
                top: `${layout.rightDrop.cy - layout.rightDrop.height / 2}px`,
                width: `${layout.rightDrop.width}px`,
                height: `${layout.rightDrop.height}px`,
              }}
            >
              Der ({board.rightEnd})
            </button>
          ) : (
            <div
              className="pointer-events-none absolute flex items-center justify-center"
              style={{
                left: `${layout.rightDrop.cx - layout.rightDrop.width / 2}px`,
                top: `${layout.rightDrop.cy - layout.rightDrop.height / 2}px`,
                width: `${layout.rightDrop.width}px`,
                height: `${layout.rightDrop.height}px`,
              }}
            >
              <span className="px-1.5 py-0.5 rounded bg-black/35 border border-white/10 text-[10px] font-display text-emerald-200/75">
                {board.rightEnd}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Discreet last-play indicator so every tile placement is easy to follow */}
      {lastAction?.type === 'play' && lastAction.tile && (
        <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/45 border border-amber-400/25 backdrop-blur-xs text-[11px] font-semibold text-amber-100/95 shadow">
          <span className="truncate max-w-[140px]">
            {lastPlayerName ?? `Asiento ${lastAction.seat + 1}`}
          </span>
          <span className="text-stone-300">tiró</span>
          <strong className="font-display text-amber-300">
            {lastAction.tile.a}·{lastAction.tile.b}
          </strong>
        </div>
      )}
    </div>
  );
}

export default DominoBoard;
