import { describe, expect, it } from 'vitest';
import {
  applyMove,
  canPass,
  computeTeamPipTotals,
  createDeck,
  createEmptyBoard,
  dealHands,
  determineOpener,
  findDoubleSixSeat,
  getHandPips,
  getMatchWinner,
  getPlayableMoves,
  getTeam,
  getTilePips,
  isBoardClosed,
  isCapicuPlay,
  isMoveValid,
  nextSeat,
  resolveDominoWin,
  resolveTrancado,
  shuffleDeck,
} from './dominoEngine.ts';
import type { SeatIndex, Tile } from './types.ts';

function t(a: number, b: number): Tile {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return { id: `${low}-${high}`, a: low, b: high };
}

describe('dominoEngine - deck & dealing', () => {
  it('creates a standard 28-tile double-6 set with a <= b and id "${a}-${b}"', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(28);
    const ids = new Set(deck.map((tile) => tile.id));
    expect(ids.size).toBe(28);
    for (const tile of deck) {
      expect(tile.a).toBeGreaterThanOrEqual(0);
      expect(tile.b).toBeLessThanOrEqual(6);
      expect(tile.a).toBeLessThanOrEqual(tile.b);
      expect(tile.id).toBe(`${tile.a}-${tile.b}`);
    }
    expect(ids.has('0-0')).toBe(true);
    expect(ids.has('6-6')).toBe(true);
  });

  it('shuffles without mutating input and preserves all 28 tiles', () => {
    const deck = createDeck();
    const originalIds = deck.map((x) => x.id);
    const shuffled = shuffleDeck(deck, () => 0.37);
    expect(deck.map((x) => x.id)).toEqual(originalIds);
    expect(shuffled).toHaveLength(28);
    expect(new Set(shuffled.map((x) => x.id)).size).toBe(28);
  });

  it('deals 7 unique tiles to each of the 4 seats totaling 28 tiles', () => {
    const hands = dealHands();
    const seen = new Set<string>();
    for (const seat of [0, 1, 2, 3] as SeatIndex[]) {
      expect(hands[seat]).toHaveLength(7);
      for (const tile of hands[seat]) {
        seen.add(tile.id);
      }
    }
    expect(seen.size).toBe(28);
  });
});

describe('dominoEngine - turn order & teams', () => {
  it('advances counter-clockwise 0 -> 1 -> 2 -> 3 -> 0', () => {
    expect(nextSeat(0)).toBe(1);
    expect(nextSeat(1)).toBe(2);
    expect(nextSeat(2)).toBe(3);
    expect(nextSeat(3)).toBe(0);
  });

  it('maps seats 0 & 2 to Team A and seats 1 & 3 to Team B', () => {
    expect(getTeam(0)).toBe('A');
    expect(getTeam(2)).toBe('A');
    expect(getTeam(1)).toBe('B');
    expect(getTeam(3)).toBe('B');
  });
});

describe('dominoEngine - opening rules', () => {
  it('opens hand 1 with the holder of 6-6 and requires playing 6-6', () => {
    const hands: Record<SeatIndex, Tile[]> = {
      0: [t(0, 1), t(2, 3)],
      1: [t(1, 1), t(4, 5)],
      2: [t(6, 6), t(0, 6)],
      3: [t(3, 3), t(5, 6)],
    };

    expect(findDoubleSixSeat(hands)).toBe(2);

    const opening = determineOpener({ handNumber: 1, hands });
    expect(opening).toEqual({ opener: 2, mustPlayDoubleSix: true });

    const moves = getPlayableMoves(hands[2], createEmptyBoard(), opening.mustPlayDoubleSix);
    expect(moves).toEqual([{ tileId: '6-6', sides: ['left'] }]);
    expect(isMoveValid(hands[2], createEmptyBoard(), '0-6', 'left', true)).toBe(false);
    expect(isMoveValid(hands[2], createEmptyBoard(), '6-6', 'left', true)).toBe(true);
  });

  it('opens subsequent hands with previous winner (any tile) or nextSeat on trancado_tie', () => {
    const hands = dealHands();

    const afterWin = determineOpener({
      handNumber: 2,
      hands,
      previousWinnerSeat: 3,
      previousOpenerSeat: 1,
      previousReason: 'domino',
    });
    expect(afterWin).toEqual({ opener: 3, mustPlayDoubleSix: false });

    const allPlayable = getPlayableMoves(hands[3], createEmptyBoard(), false);
    expect(allPlayable).toHaveLength(7);
    expect(allPlayable.every((m) => m.sides.length === 1 && m.sides[0] === 'left')).toBe(true);

    const afterTie = determineOpener({
      handNumber: 3,
      hands,
      previousWinnerSeat: null,
      previousOpenerSeat: 3,
      previousReason: 'trancado_tie',
    });
    expect(afterTie).toEqual({ opener: 0, mustPlayDoubleSix: false });
  });
});

describe('dominoEngine - valid moves, double ends, board orientation & anchorIndex', () => {
  it('returns both left and right when leftEnd === rightEnd on a non-empty board', () => {
    let board = createEmptyBoard();
    board = applyMove(board, t(6, 6), 'left', 0);
    expect(board.leftEnd).toBe(6);
    expect(board.rightEnd).toBe(6);
    expect(board.anchorIndex).toBe(0);

    const hand = [t(4, 6), t(1, 2)];
    const moves = getPlayableMoves(hand, board, false);
    expect(moves).toEqual([{ tileId: '4-6', sides: ['left', 'right'] }]);
  });

  it('also returns both left and right on longer chains whose open ends match', () => {
    let board = createEmptyBoard();
    board = applyMove(board, t(6, 6), 'left', 0);
    board = applyMove(board, t(3, 6), 'left', 1); // ends: 3, 6
    board = applyMove(board, t(3, 6), 'right', 2); // hypothetical ends: 3, 3
    expect(board.leftEnd).toBe(3);
    expect(board.rightEnd).toBe(3);

    const moves = getPlayableMoves([t(3, 5), t(2, 4)], board, false);
    expect(moves).toEqual([{ tileId: '3-5', sides: ['left', 'right'] }]);
  });

  it('orients tiles left-to-right and shifts anchorIndex + 1 only on left additions', () => {
    let board = createEmptyBoard();
    // Anchor: 6-6 at index 0
    board = applyMove(board, t(6, 6), 'left', 0);
    expect(board.anchorIndex).toBe(0);
    expect(board.chain[0]).toMatchObject({
      leftValue: 6,
      rightValue: 6,
      isDouble: true,
      playedBy: 0,
    });

    // Left: 2-6 -> leftValue=2, rightValue=6, anchorIndex -> 1
    board = applyMove(board, t(2, 6), 'left', 1);
    expect(board.anchorIndex).toBe(1);
    expect(board.leftEnd).toBe(2);
    expect(board.rightEnd).toBe(6);
    expect(board.chain[0]).toMatchObject({
      leftValue: 2,
      rightValue: 6,
      isDouble: false,
      playedBy: 1,
    });

    // Right: 4-6 -> leftValue=6, rightValue=4, anchorIndex stays 1
    board = applyMove(board, t(4, 6), 'right', 2);
    expect(board.anchorIndex).toBe(1);
    expect(board.leftEnd).toBe(2);
    expect(board.rightEnd).toBe(4);
    expect(board.chain[2]).toMatchObject({
      leftValue: 6,
      rightValue: 4,
      isDouble: false,
      playedBy: 2,
    });

    // Left: 2-5 -> leftValue=5, rightValue=2, anchorIndex -> 2
    board = applyMove(board, t(2, 5), 'left', 3);
    expect(board.anchorIndex).toBe(2);
    expect(board.leftEnd).toBe(5);
    expect(board.rightEnd).toBe(4);

    // Verify full chain continuity left-to-right
    for (let i = 0; i < board.chain.length - 1; i++) {
      expect(board.chain[i].rightValue).toBe(board.chain[i + 1].leftValue);
    }
    expect(board.chain[board.anchorIndex].tile.id).toBe('6-6');
  });

  it('throws if applyMove is called with a non-matching tile', () => {
    const board = applyMove(createEmptyBoard(), t(6, 6), 'left', 0);
    expect(() => applyMove(board, t(1, 2), 'left', 1)).toThrow();
    expect(() => applyMove(board, t(1, 2), 'right', 1)).toThrow();
  });
});

describe('dominoEngine - pass validation', () => {
  it('allows passing only when playableMoves is empty', () => {
    const board = applyMove(createEmptyBoard(), t(6, 6), 'left', 0);
    expect(canPass([t(0, 1), t(2, 5)], board, false)).toBe(true);
    expect(canPass([t(0, 6), t(2, 5)], board, false)).toBe(false);
    expect(canPass([t(0, 1)], createEmptyBoard(), false)).toBe(false);
    expect(canPass([t(0, 1)], createEmptyBoard(), true)).toBe(true);
  });
});

describe('dominoEngine - scoring, trancado & match win', () => {
  it('calculates tile and hand pips accurately', () => {
    expect(getTilePips(t(3, 5))).toBe(8);
    expect(getHandPips([t(0, 0), t(2, 4), t(5, 6)])).toBe(17);
  });

  it('resolves domino win under all_remaining and opponents_only modes', () => {
    const hands: Record<SeatIndex, Tile[]> = {
      0: [], // winner (Team A)
      1: [t(5, 6)], // 11 pips (Team B)
      2: [t(2, 3)], // 5 pips (Team A partner)
      3: [t(4, 4)], // 8 pips (Team B)
    };
    expect(computeTeamPipTotals(hands)).toEqual({ A: 5, B: 19 });

    const allRemaining = resolveDominoWin({
      handNumber: 1,
      winnerSeat: 0,
      hands,
      scoringMode: 'all_remaining',
      currentScores: { A: 10, B: 20 },
    });
    expect(allRemaining.reason).toBe('domino');
    expect(allRemaining.winnerTeam).toBe('A');
    expect(allRemaining.winnerSeat).toBe(0);
    expect(allRemaining.pointsAwarded).toBe(24);
    expect(allRemaining.cumulativeScores).toEqual({ A: 34, B: 20 });

    const opponentsOnly = resolveDominoWin({
      handNumber: 1,
      winnerSeat: 0,
      hands,
      scoringMode: 'opponents_only',
      currentScores: { A: 10, B: 20 },
    });
    expect(opponentsOnly.pointsAwarded).toBe(19);
    expect(opponentsOnly.cumulativeScores).toEqual({ A: 29, B: 20 });
  });

  it('detects Capicú plays and awards +25 only when capicuBonus is enabled', () => {
    const empty = createEmptyBoard();
    expect(isCapicuPlay(t(2, 5), empty)).toBe(false);

    let board = applyMove(empty, t(6, 6), 'left', 0); // ends 6 & 6 (equal)
    expect(isCapicuPlay(t(6, 6), board)).toBe(false);
    board = applyMove(board, t(2, 6), 'left', 1); // left=2, right=6
    board = applyMove(board, t(5, 6), 'right', 2); // left=2, right=5

    expect(isCapicuPlay(t(2, 5), board)).toBe(true);
    expect(isCapicuPlay(t(2, 2), board)).toBe(false); // double cannot be capicú
    expect(isCapicuPlay(t(1, 5), board)).toBe(false); // fits only one end

    const hands: Record<SeatIndex, Tile[]> = {
      0: [],
      1: [t(1, 3)], // 4
      2: [t(0, 1)], // 1
      3: [t(2, 4)], // 6 -> opponents = 10
    };

    const withoutBonus = resolveDominoWin({
      handNumber: 1,
      winnerSeat: 0,
      hands,
      scoringMode: 'opponents_only',
      currentScores: { A: 0, B: 0 },
      capicuBonus: false,
      isCapicu: true,
    });
    expect(withoutBonus.pointsAwarded).toBe(10);
    expect(withoutBonus.isCapicu).toBe(false);

    const withBonus = resolveDominoWin({
      handNumber: 1,
      winnerSeat: 0,
      hands,
      scoringMode: 'opponents_only',
      currentScores: { A: 0, B: 0 },
      capicuBonus: true,
      isCapicu: true,
    });
    expect(withBonus.pointsAwarded).toBe(35);
    expect(withBonus.isCapicu).toBe(true);
  });

  it('resolves Juego Cerrado (resolveTrancado) awarding losing pair pips regardless of scoringMode', () => {
    const hands: Record<SeatIndex, Tile[]> = {
      0: [t(1, 2)], // 3 pips
      1: [t(5, 5)], // 10 pips
      2: [t(0, 4)], // 4 pips -> Team A = 7
      3: [t(3, 4)], // 7 pips -> Team B = 17
    };

    const allRem = resolveTrancado({
      handNumber: 2,
      hands,
      scoringMode: 'all_remaining',
      currentScores: { A: 40, B: 30 },
    });
    expect(allRem.reason).toBe('trancado');
    expect(allRem.winnerTeam).toBe('A');
    expect(allRem.winnerSeat).toBe(0); // seat 0 has 3 pips <= seat 2's 4 pips
    expect(allRem.pointsAwarded).toBe(17);
    expect(allRem.cumulativeScores).toEqual({ A: 57, B: 30 });

    const oppOnly = resolveTrancado({
      handNumber: 2,
      hands,
      scoringMode: 'opponents_only',
      currentScores: { A: 40, B: 30 },
    });
    expect(oppOnly.pointsAwarded).toBe(17);
    expect(oppOnly.cumulativeScores).toEqual({ A: 57, B: 30 });
  });

  it('resolves trancado_tie when both teams have equal pips and awards 0 points', () => {
    const hands: Record<SeatIndex, Tile[]> = {
      0: [t(2, 3)], // 5
      1: [t(1, 4)], // 5
      2: [t(0, 5)], // 5 -> Team A = 10
      3: [t(2, 3)], // 5 -> Team B = 10
    };

    const tie = resolveTrancado({
      handNumber: 3,
      hands,
      scoringMode: 'all_remaining',
      currentScores: { A: 55, B: 60 },
    });
    expect(tie.reason).toBe('trancado_tie');
    expect(tie.winnerTeam).toBeNull();
    expect(tie.winnerSeat).toBeNull();
    expect(tie.pointsAwarded).toBe(0);
    expect(tie.teamPipTotals).toEqual({ A: 10, B: 10 });
    expect(tie.cumulativeScores).toEqual({ A: 55, B: 60 });
  });

  it('detects immediate Juego Cerrado (isBoardClosed) as soon as no player can move', () => {
    const emptyBoard = createEmptyBoard();
    const handsWithMove: Record<SeatIndex, Tile[]> = {
      0: [t(1, 2)],
      1: [t(3, 4)],
      2: [t(0, 6)],
      3: [t(5, 5)],
    };
    expect(isBoardClosed(handsWithMove, emptyBoard)).toBe(false);

    const openBoard = applyMove(emptyBoard, t(6, 6), 'left', 0);
    // Seat 2 holds 0-6, so board is NOT closed yet
    expect(isBoardClosed(handsWithMove, openBoard)).toBe(false);

    const closedHands: Record<SeatIndex, Tile[]> = {
      0: [t(1, 2)],
      1: [t(3, 4)],
      2: [t(0, 5)],
      3: [t(5, 5)],
    };
    // Open ends are 6 and 6; none of the 4 hands have a 6
    expect(isBoardClosed(closedHands, openBoard)).toBe(true);
  });

  it('detects match winner when cumulative score reaches targetScore (e.g., 100)', () => {
    expect(getMatchWinner({ A: 99, B: 85 }, 100)).toBeNull();
    expect(getMatchWinner({ A: 100, B: 85 }, 100)).toBe('A');
    expect(getMatchWinner({ A: 90, B: 112 }, 100)).toBe('B');
  });
});
