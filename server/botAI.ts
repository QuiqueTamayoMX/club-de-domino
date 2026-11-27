import {
  applyMove,
  getPartnerSeat,
  getPlayableMoves,
  getTilePips,
  nextSeat,
} from '../shared/dominoEngine.ts';
import type { BoardState, SeatIndex, Tile } from '../shared/types.ts';

export type BotDecision =
  | { type: 'play'; tileId: string; side: 'left' | 'right' }
  | { type: 'pass' };

export interface BotMoveContext {
  seat: SeatIndex;
  hand: readonly Tile[];
  board: BoardState;
  mustPlayDoubleSix: boolean;
  passedSuitsBySeat?: Record<SeatIndex, ReadonlySet<number>>;
  seatTileCounts?: Record<SeatIndex, number>;
}

/**
 * Counts how many times each pip suit (0..6) appears in a set of tiles.
 */
function countSuits(tiles: readonly Tile[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const tile of tiles) {
    counts[tile.a] += 1;
    if (tile.b !== tile.a) {
      counts[tile.b] += 1;
    }
  }
  return counts;
}

/**
 * Chooses a strategic move for a Mexican Partner Dominoes bot.
 * Balances shedding doubles (mulas) and heavy pips while protecting
 * partner suits and pressuring opponents' known missing suits.
 */
export function chooseBotMove(ctx: BotMoveContext): BotDecision {
  const {
    seat,
    hand,
    board,
    mustPlayDoubleSix,
    passedSuitsBySeat,
    seatTileCounts,
  } = ctx;

  const moves = getPlayableMoves(hand, board, mustPlayDoubleSix);
  if (moves.length === 0) {
    return { type: 'pass' };
  }

  if (mustPlayDoubleSix) {
    const doubleSixMove = moves.find((m) => m.tileId === '6-6');
    if (doubleSixMove) {
      return {
        type: 'play',
        tileId: doubleSixMove.tileId,
        side: doubleSixMove.sides[0],
      };
    }
  }

  const partnerSeat = getPartnerSeat(seat);
  const rightOpponent = nextSeat(seat);
  const leftOpponent = nextSeat(partnerSeat);
  const partnerPassed = passedSuitsBySeat?.[partnerSeat];
  const rightOppPassed = passedSuitsBySeat?.[rightOpponent];
  const leftOppPassed = passedSuitsBySeat?.[leftOpponent];

  const partnerLow = (seatTileCounts?.[partnerSeat] ?? 7) <= 2;
  const oppLow =
    (seatTileCounts?.[rightOpponent] ?? 7) <= 2 ||
    (seatTileCounts?.[leftOpponent] ?? 7) <= 2;

  let bestDecision: BotDecision | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    const tile = hand.find((t) => t.id === move.tileId);
    if (!tile) continue;

    // Immediate domino win if this is the bot's last tile
    if (hand.length === 1) {
      return {
        type: 'play',
        tileId: move.tileId,
        side: move.sides[0],
      };
    }

    const remainingHand = hand.filter((t) => t.id !== tile.id);
    const remainingSuits = countSuits(remainingHand);
    const isDouble = tile.a === tile.b;
    const pips = getTilePips(tile);

    for (const side of move.sides) {
      const nextBoard = applyMove(board, tile, side, seat);
      const leftEnd = nextBoard.leftEnd;
      const rightEnd = nextBoard.rightEnd;

      let score = 0;

      // 1. Shed heavy pip-count tiles (more urgent if an opponent is low)
      score += pips * (oppLow ? 2.1 : 1.35);

      // 2. Play doubles (mulas) early when safe to avoid getting stuck with them
      if (isDouble) {
        score += 18 + tile.a * 2.5;
        if (remainingSuits[tile.a] > 0) {
          // Safe double: bot still holds another tile of that suit
          score += 6;
        }
      }

      // 3. Keep flexibility in our own remaining hand
      if (leftEnd !== null) {
        score += remainingSuits[leftEnd] * 3.5;
      }
      if (rightEnd !== null && rightEnd !== leftEnd) {
        score += remainingSuits[rightEnd] * 3.5;
      }
      if (
        leftEnd !== null &&
        rightEnd !== null &&
        remainingSuits[leftEnd] === 0 &&
        remainingSuits[rightEnd] === 0
      ) {
        score -= 7;
      }

      // 4. Partner protection: avoid leaving ends that partner has passed on
      if (partnerPassed) {
        if (leftEnd !== null && partnerPassed.has(leftEnd)) {
          score -= partnerLow ? 22 : 13;
        }
        if (rightEnd !== null && partnerPassed.has(rightEnd)) {
          score -= partnerLow ? 22 : 13;
        }
        if (
          leftEnd !== null &&
          leftEnd === rightEnd &&
          partnerPassed.has(leftEnd)
        ) {
          // Locking both ends to a suit partner lacks
          score -= 18;
        }
      }

      // 5. Opponent pressure: favor ends that opponents have already passed on
      const exposedEnd = side === 'left' ? leftEnd : rightEnd;
      if (rightOppPassed && exposedEnd !== null && rightOppPassed.has(exposedEnd)) {
        // Right-hand opponent plays immediately next
        score += (seatTileCounts?.[rightOpponent] ?? 7) <= 3 ? 16 : 11;
      }
      if (leftOppPassed && exposedEnd !== null && leftOppPassed.has(exposedEnd)) {
        score += (seatTileCounts?.[leftOpponent] ?? 7) <= 3 ? 13 : 8;
      }

      // 6. Opening heuristics when board is empty (hands 2+)
      if (board.chain.length === 0) {
        const suitStrength = remainingSuits[tile.a] + remainingSuits[tile.b];
        score += suitStrength * 2.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDecision = { type: 'play', tileId: tile.id, side };
      }
    }
  }

  return bestDecision ?? { type: 'pass' };
}
