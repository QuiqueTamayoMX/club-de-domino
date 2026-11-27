import type { Tile } from '../../shared/types';

export type DominoTileSize = 'xs' | 'sm' | 'md' | 'lg';
export type DominoTileOrientation = 'vertical' | 'horizontal';

export interface DominoTileProps {
  tile?: Tile;
  /** Value for top half (vertical) or left half (horizontal). Falls back to tile.a */
  leftValue?: number;
  /** Value for bottom half (vertical) or right half (horizontal). Falls back to tile.b */
  rightValue?: number;
  orientation?: DominoTileOrientation;
  size?: DominoTileSize;
  faceDown?: boolean;
  selected?: boolean;
  playable?: boolean;
  disabled?: boolean;
  lastPlayed?: boolean;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}

const SIZE_DIMENSIONS: Record<
  DominoTileSize,
  {
    vertical: string;
    horizontal: string;
    pipSize: string;
    pipOneSize: string;
    pad: string;
    pinSize: string;
    radius: string;
  }
> = {
  xs: {
    vertical: 'w-6 h-12',
    horizontal: 'w-12 h-6',
    pipSize: 'w-[3.5px] h-[3.5px]',
    pipOneSize: 'w-[4.5px] h-[4.5px]',
    pad: 'p-[2px]',
    pinSize: 'w-[3px] h-[3px]',
    radius: 'rounded-[5px]',
  },
  sm: {
    vertical: 'w-8 h-16',
    horizontal: 'w-16 h-8',
    pipSize: 'w-[4.5px] h-[4.5px]',
    pipOneSize: 'w-[6px] h-[6px]',
    pad: 'p-[3px]',
    pinSize: 'w-[4px] h-[4px]',
    radius: 'rounded-[6px]',
  },
  md: {
    vertical: 'w-10 h-20',
    horizontal: 'w-20 h-10',
    pipSize: 'w-[5.5px] h-[5.5px]',
    pipOneSize: 'w-[7.5px] h-[7.5px]',
    pad: 'p-[4px]',
    pinSize: 'w-[5px] h-[5px]',
    radius: 'rounded-[8px]',
  },
  lg: {
    vertical: 'w-12 h-24',
    horizontal: 'w-24 h-12',
    pipSize: 'w-[6.5px] h-[6.5px]',
    pipOneSize: 'w-[9px] h-[9px]',
    pad: 'p-[5px]',
    pinSize: 'w-[6px] h-[6px]',
    radius: 'rounded-[10px]',
  },
};

/** Traditional color-coding for instant mobile readability */
const PIP_COLOR_BY_VALUE: Record<number, string> = {
  0: 'bg-transparent',
  1: 'bg-[#b91c1c] ring-1 ring-amber-400/50',
  2: 'bg-[#1e3a8a]',
  3: 'bg-[#15803d]',
  4: 'bg-[#dc2626]',
  5: 'bg-[#1d4ed8]',
  6: 'bg-[#1c1917]',
};

function getPipIndices(value: number, horizontal: boolean): Set<number> {
  switch (value) {
    case 1:
      return new Set([4]);
    case 2:
      return new Set(horizontal ? [2, 6] : [0, 8]);
    case 3:
      return new Set(horizontal ? [2, 4, 6] : [0, 4, 8]);
    case 4:
      return new Set([0, 2, 6, 8]);
    case 5:
      return new Set([0, 2, 4, 6, 8]);
    case 6:
      // 3x2 grid when horizontal, 2x3 grid when vertical
      return new Set(horizontal ? [0, 1, 2, 6, 7, 8] : [0, 2, 3, 5, 6, 8]);
    default:
      return new Set();
  }
}

function PipHalf({
  value,
  horizontal,
  size,
}: {
  value: number;
  horizontal: boolean;
  size: DominoTileSize;
}) {
  const cfg = SIZE_DIMENSIONS[size];
  const active = getPipIndices(value, horizontal);
  const colorClass = PIP_COLOR_BY_VALUE[value] ?? 'bg-stone-900';
  const dotSize = value === 1 ? cfg.pipOneSize : cfg.pipSize;

  return (
    <div className={`grid grid-cols-3 grid-rows-3 place-items-center w-full h-full ${cfg.pad}`}>
      {Array.from({ length: 9 }, (_, idx) => (
        <span
          key={idx}
          className={
            active.has(idx)
              ? `${dotSize} rounded-full ${colorClass} shadow-[inset_0_1px_1px_rgba(0,0,0,0.45),0_0.5px_0_rgba(255,255,255,0.65)]`
              : 'w-0 h-0'
          }
        />
      ))}
    </div>
  );
}

export function DominoTile({
  tile,
  leftValue,
  rightValue,
  orientation = 'vertical',
  size = 'md',
  faceDown = false,
  selected = false,
  playable = false,
  disabled = false,
  lastPlayed = false,
  onClick,
  className = '',
  ariaLabel,
}: DominoTileProps) {
  const cfg = SIZE_DIMENSIONS[size];
  const isHorizontal = orientation === 'horizontal';
  const dimClass = isHorizontal ? cfg.horizontal : cfg.vertical;
  const first = leftValue ?? tile?.a ?? 0;
  const second = rightValue ?? tile?.b ?? 0;

  const stateClasses = [
    selected
      ? '-translate-y-2.5 scale-[1.06] ring-2 ring-amber-300 shadow-[0_10px_22px_rgba(212,175,55,0.5),0_3px_0_#a6906a]'
      : '',
    !selected && lastPlayed
      ? 'ring-2 ring-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.55),0_3px_0_#b5a382] animate-tile-pop'
      : '',
    !selected && !lastPlayed && playable
      ? 'ring-2 ring-amber-300/80 shadow-[0_4px_14px_rgba(212,175,55,0.28),0_3px_0_#b5a382] hover:-translate-y-1'
      : '',
    disabled ? 'opacity-45 saturate-75' : '',
    onClick && !disabled ? 'cursor-pointer active:scale-95' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (faceDown) {
    const backClasses = `relative inline-flex items-center justify-center select-none transition-all duration-150 ${dimClass} ${cfg.radius} bg-gradient-to-br from-[#52301c] via-[#381e10] to-[#221108] border border-amber-500/45 shadow-[0_2px_0_#1a0c05,0_4px_8px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,228,175,0.2)] ${stateClasses} ${className}`;
    return (
      <div className={backClasses} aria-label={ariaLabel ?? 'Ficha oculta'}>
        <div className="w-[65%] h-[65%] rounded-[3px] border border-amber-400/35 flex items-center justify-center">
          <div className="w-1.5 h-1.5 rotate-45 bg-amber-400/55" />
        </div>
      </div>
    );
  }

  const baseClasses = `relative inline-flex ${
    isHorizontal ? 'flex-row' : 'flex-col'
  } items-stretch justify-between select-none transition-all duration-150 ${dimClass} ${cfg.radius} bg-gradient-to-b from-[#fffdf7] via-[#f7efdd] to-[#e9dcc2] border border-[#d6c7a9] shadow-[0_3px_0_#b2a07e,0_5px_12px_rgba(0,0,0,0.42),inset_0_1px_1px_rgba(255,255,255,0.95)] ${stateClasses} ${className}`;

  const content = (
    <>
      <div className="flex-1 flex items-center justify-center">
        <PipHalf value={first} horizontal={isHorizontal} size={size} />
      </div>

      {/* Divider line with central brass/gold spinner pin */}
      <div
        className={`relative shrink-0 ${
          isHorizontal ? 'w-[1.5px] h-[78%] self-center' : 'h-[1.5px] w-[78%] self-center'
        } bg-[#3d2314]/65 rounded-full`}
      >
        <span
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${cfg.pinSize} rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 border border-amber-900/40 shadow-[0_0.5px_1px_rgba(0,0,0,0.5)]`}
        />
      </div>

      <div className="flex-1 flex items-center justify-center">
        <PipHalf value={second} horizontal={isHorizontal} size={size} />
      </div>
    </>
  );

  const label = ariaLabel ?? `Ficha ${first} con ${second}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={label}
        className={baseClasses}
      >
        {content}
      </button>
    );
  }

  return (
    <div aria-label={label} className={baseClasses}>
      {content}
    </div>
  );
}

export default DominoTile;
