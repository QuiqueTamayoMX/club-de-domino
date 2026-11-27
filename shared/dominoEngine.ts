import type {
  BoardState,
  HandResult,
  PlacedTile,
  PlayableMove,
  RoomSettings,
  SeatIndex,
  TeamId,
  Tile,
} from './types.ts';

export const SEATS: readonly SeatIndex[] = [0, 1, 2, 3];

/**
 * Creates a standard double-6 domino set (28 tiles, a <= b).
 */
export function createDeck(): Tile[] {
  const deck: Tile[] = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      deck.push({ id: `${a}-${b}`, a, b });
    }
  }
  return deck;
}

/**
 * Returns a shuffled copy of the deck using Fisher-Yates.
 */
export function shuffleDeck(
  deck: readonly Tile[],
  rng: () => number = Math.random
): Tile[] {
  const copy = deck.map((tile) => ({ ...tile }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Deals 7 tiles to each of the 4 seats from a newly shuffled 28-tile deck.
 */
export function dealHands(
  rng: () => number = Math.random
): Record<SeatIndex, Tile[]> {
  const shuffled = shuffleDeck(createDeck(), rng);
  return {
    0: shuffled.slice(0, 7),
    1: shuffled.slice(7, 14),
    2: shuffled.slice(14, 21),
    3: shuffled.slice(21, 28),
  };
}

/**
 * Counter-clockwise turn order: 0 -> 1 -> 2 -> 3 -> 0.
 */
export function nextSeat(seat: SeatIndex): SeatIndex {
  return ((seat + 1) % 4) as SeatIndex;
}

/**
 * Partner mapping: 0 & 2 -> Team A (Sur/Norte), 1 & 3 -> Team B (Este/Oeste).
 */
export function getTeam(seat: SeatIndex): TeamId {
  return seat === 0 || seat === 2 ? 'A' : 'B';
}

export function getPartnerSeat(seat: SeatIndex): SeatIndex {
  return ((seat + 2) % 4) as SeatIndex;
}

export function getTilePips(tile: Tile): number {
  return tile.a + tile.b;
}

export function getHandPips(hand: readonly Tile[]): number {
  let total = 0;
  for (const tile of hand) {
    total += tile.a + tile.b;
  }
  return total;
}

export function createEmptyBoard(): BoardState {
  return {
    chain: [],
    leftEnd: null,
    rightEnd: null,
    anchorIndex: 0,
  };
}

export function findDoubleSixSeat(
  hands: Record<SeatIndex, readonly Tile[]>
): SeatIndex | null {
  for (const seat of SEATS) {
    if (hands[seat].some((t) => t.id === '6-6')) {
      return seat;
    }
  }
  return null;
}

/**
 * Determines who opens a hand and whether they must play 6-6.
 * - Hand 1: holder of 6-6 opens and must play 6-6.
 * - Subsequent hands: previous hand winner opens (any tile);
 *   if previous hand was a trancado_tie, nextSeat(previousOpener) opens.
 */
export function determineOpener(params: {
  handNumber: number;
  hands: Record<SeatIndex, readonly Tile[]>;
  previousWinnerSeat?: SeatIndex | null;
  previousOpenerSeat?: SeatIndex | null;
  previousReason?: HandResult['reason'] | null;
}): { opener: SeatIndex; mustPlayDoubleSix: boolean } {
  const { handNumber, hands, previousWinnerSeat, previousOpenerSeat, previousReason } = params;

  if (handNumber === 1) {
    const doubleSixSeat = findDoubleSixSeat(hands);
    return {
      opener: doubleSixSeat ?? 0,
      mustPlayDoubleSix: true,
    };
  }

  if (previousReason === 'trancado_tie' || previousWinnerSeat == null) {
    return {
      opener: nextSeat(previousOpenerSeat ?? 0),
      mustPlayDoubleSix: false,
    };
  }

  return {
    opener: previousWinnerSeat,
    mustPlayDoubleSix: false,
  };
}

/**
 * Returns all playable tiles and valid sides for a hand given the board state.
 * - On an empty board, valid side is normalized to ['left'].
 * - On a non-empty board, checks both leftEnd and rightEnd (even if leftEnd === rightEnd).
 * - If mustPlayDoubleSix is true, only '6-6' can be played.
 */
export function getPlayableMoves(
  hand: readonly Tile[],
  board: BoardState,
  mustPlayDoubleSix: boolean
): PlayableMove[] {
  const candidateTiles = mustPlayDoubleSix
    ? hand.filter((tile) => tile.id === '6-6')
    : hand;

  if (board.chain.length === 0) {
    return candidateTiles.map((tile) => ({
      tileId: tile.id,
      sides: ['left'],
    }));
  }

  const { leftEnd, rightEnd } = board;
  const moves: PlayableMove[] = [];

  for (const tile of candidateTiles) {
    const sides: ('left' | 'right')[] = [];
    if (leftEnd !== null && (tile.a === leftEnd || tile.b === leftEnd)) {
      sides.push('left');
    }
    if (rightEnd !== null && (tile.a === rightEnd || tile.b === rightEnd)) {
      sides.push('right');
    }
    if (sides.length > 0) {
      moves.push({ tileId: tile.id, sides });
    }
  }

  return moves;
}

export function isMoveValid(
  hand: readonly Tile[],
  board: BoardState,
  tileId: string,
  side: 'left' | 'right',
  mustPlayDoubleSix: boolean
): boolean {
  const moves = getPlayableMoves(hand, board, mustPlayDoubleSix);
  const move = moves.find((m) => m.tileId === tileId);
  return move ? move.sides.includes(side) : false;
}

export function canPass(
  hand: readonly Tile[],
  board: BoardState,
  mustPlayDoubleSix: boolean
): boolean {
  return getPlayableMoves(hand, board, mustPlayDoubleSix).length === 0;
}

/**
 * Checks whether the board is immediately closed ("Juego Cerrado") because none
 * of the 4 players can play on either open end.
 */
export function isBoardClosed(
  hands: Record<SeatIndex, readonly Tile[]>,
  board: BoardState
): boolean {
  if (board.chain.length === 0) return false;
  return SEATS.every((seat) => getPlayableMoves(hands[seat], board, false).length === 0);
}

/**
 * Places a tile onto the board on the chosen side, keeping leftValue/rightValue
 * oriented left-to-right and updating anchorIndex when prepending to the left.
 */
export function applyMove(
  board: BoardState,
  tile: Tile,
  side: 'left' | 'right',
  seat: SeatIndex
): BoardState {
  const isDouble = tile.a === tile.b;

  if (board.chain.length === 0) {
    const placed: PlacedTile = {
      tile,
      leftValue: tile.a,
      rightValue: tile.b,
      isDouble,
      playedBy: seat,
    };
    return {
      chain: [placed],
      leftEnd: tile.a,
      rightEnd: tile.b,
      anchorIndex: 0,
    };
  }

  if (side === 'left') {
    const target = board.leftEnd;
    if (target === null || (tile.a !== target && tile.b !== target)) {
      throw new Error(`Tile ${tile.id} cannot be played on left end (${target})`);
    }
    const rightValue = target;
    const leftValue = tile.a === target ? tile.b : tile.a;
    const placed: PlacedTile = {
      tile,
      leftValue,
      rightValue,
      isDouble,
      playedBy: seat,
    };
    return {
      chain: [placed, ...board.chain],
      leftEnd: leftValue,
      rightEnd: board.rightEnd,
      anchorIndex: board.anchorIndex + 1,
    };
  }

  const target = board.rightEnd;
  if (target === null || (tile.a !== target && tile.b !== target)) {
    throw new Error(`Tile ${tile.id} cannot be played on right end (${target})`);
  }
  const leftValue = target;
  const rightValue = tile.a === target ? tile.b : tile.a;
  const placed: PlacedTile = {
    tile,
    leftValue,
    rightValue,
    isDouble,
    playedBy: seat,
  };
  return {
    chain: [...board.chain, placed],
    leftEnd: board.leftEnd,
    rightEnd: rightValue,
    anchorIndex: board.anchorIndex,
  };
}

export function computeTeamPipTotals(
  hands: Record<SeatIndex, readonly Tile[]>
): { A: number; B: number } {
  return {
    A: getHandPips(hands[0]) + getHandPips(hands[2]),
    B: getHandPips(hands[1]) + getHandPips(hands[3]),
  };
}

function cloneHands(
  hands: Record<SeatIndex, readonly Tile[]>
): Record<SeatIndex, Tile[]> {
  return {
    0: hands[0].map((t) => ({ ...t })),
    1: hands[1].map((t) => ({ ...t })),
    2: hands[2].map((t) => ({ ...t })),
    3: hands[3].map((t) => ({ ...t })),
  };
}

function computeAwardedPoints(
  winnerTeam: TeamId,
  teamPipTotals: { A: number; B: number },
  scoringMode: RoomSettings['scoringMode']
): number {
  if (scoringMode === 'all_remaining') {
    return teamPipTotals.A + teamPipTotals.B;
  }
  return winnerTeam === 'A' ? teamPipTotals.B : teamPipTotals.A;
}

/**
 * Checks whether playing `tile` as the final tile onto `boardBeforeMove` qualifies
 * as a Capicú (non-double tile matching two distinct open ends on a non-empty board).
 */
export function isCapicuPlay(tile: Tile, boardBeforeMove: BoardState): boolean {
  if (boardBeforeMove.chain.length === 0) return false;
  if (tile.a === tile.b) return false;
  const { leftEnd, rightEnd } = boardBeforeMove;
  if (leftEnd === null || rightEnd === null || leftEnd === rightEnd) {
    return false;
  }
  return (
    (tile.a === leftEnd && tile.b === rightEnd) ||
    (tile.a === rightEnd && tile.b === leftEnd)
  );
}

/**
 * Resolves a hand won by a player playing their last tile ("domino").
 */
export function resolveDominoWin(params: {
  handNumber: number;
  winnerSeat: SeatIndex;
  hands: Record<SeatIndex, readonly Tile[]>;
  scoringMode: RoomSettings['scoringMode'];
  currentScores: { A: number; B: number };
  capicuBonus?: boolean;
  isCapicu?: boolean;
}): HandResult {
  const {
    handNumber,
    winnerSeat,
    hands,
    scoringMode,
    currentScores,
    capicuBonus = false,
    isCapicu = false,
  } = params;
  const winnerTeam = getTeam(winnerSeat);
  const teamPipTotals = computeTeamPipTotals(hands);
  const basePoints = computeAwardedPoints(winnerTeam, teamPipTotals, scoringMode);
  const bonusApplied = Boolean(capicuBonus && isCapicu);
  const pointsAwarded = basePoints + (bonusApplied ? 25 : 0);

  const cumulativeScores = {
    A: currentScores.A + (winnerTeam === 'A' ? pointsAwarded : 0),
    B: currentScores.B + (winnerTeam === 'B' ? pointsAwarded : 0),
  };

  return {
    handNumber,
    winnerTeam,
    winnerSeat,
    reason: 'domino',
    pointsAwarded,
    isCapicu: bonusApplied,
    remainingHands: cloneHands(hands),
    teamPipTotals,
    cumulativeScores,
  };
}

/**
 * Resolves a blocked hand ("Juego Cerrado") after 4 consecutive passes.
 * The pair with higher remaining hand pips loses, and the winning pair
 * scores the losing pair's total remaining pips.
 */
export function resolveTrancado(params: {
  handNumber: number;
  hands: Record<SeatIndex, readonly Tile[]>;
  scoringMode: RoomSettings['scoringMode'];
  currentScores: { A: number; B: number };
}): HandResult {
  const { handNumber, hands, currentScores } = params;
  const teamPipTotals = computeTeamPipTotals(hands);
  const remainingHands = cloneHands(hands);

  if (teamPipTotals.A === teamPipTotals.B) {
    return {
      handNumber,
      winnerTeam: null,
      winnerSeat: null,
      reason: 'trancado_tie',
      pointsAwarded: 0,
      remainingHands,
      teamPipTotals,
      cumulativeScores: { ...currentScores },
    };
  }

  const winnerTeam: TeamId = teamPipTotals.A < teamPipTotals.B ? 'A' : 'B';
  const teamSeats: [SeatIndex, SeatIndex] = winnerTeam === 'A' ? [0, 2] : [1, 3];
  const winnerSeat: SeatIndex =
    getHandPips(hands[teamSeats[0]]) <= getHandPips(hands[teamSeats[1]])
      ? teamSeats[0]
      : teamSeats[1];

  const pointsAwarded = winnerTeam === 'A' ? teamPipTotals.B : teamPipTotals.A;
  const cumulativeScores = {
    A: currentScores.A + (winnerTeam === 'A' ? pointsAwarded : 0),
    B: currentScores.B + (winnerTeam === 'B' ? pointsAwarded : 0),
  };

  return {
    handNumber,
    winnerTeam,
    winnerSeat,
    reason: 'trancado',
    pointsAwarded,
    remainingHands,
    teamPipTotals,
    cumulativeScores,
  };
}

export function getMatchWinner(
  scores: { A: number; B: number },
  targetScore: number
): TeamId | null {
  const aReached = scores.A >= targetScore;
  const bReached = scores.B >= targetScore;
  if (!aReached && !bReached) return null;
  if (aReached && !bReached) return 'A';
  if (bReached && !aReached) return 'B';
  return scores.A >= scores.B ? 'A' : 'B';
}
