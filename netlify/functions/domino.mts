import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import {
  SEATS,
  applyMove,
  canPass,
  createEmptyBoard,
  dealHands,
  determineOpener,
  getMatchWinner,
  getPlayableMoves,
  isBoardClosed,
  isCapicuPlay,
  isMoveValid,
  nextSeat,
  resolveDominoWin,
  resolveTrancado,
} from '../../shared/dominoEngine.ts';
import type {
  BoardState,
  ClientGameState,
  GamePhase,
  HandResult,
  LastAction,
  RoomSettings,
  SeatIndex,
  TeamId,
  Tile,
} from '../../shared/types.ts';
import { chooseBotMove } from '../../server/botAI.ts';

export const config: Config = {
  path: '/api/domino',
};

const STORE_NAME = 'club-de-domino-rooms';
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = [
  'Don Beto',
  'Doña Lupe',
  'El Güero',
  'La Chata',
  'Don Pepe',
  'Doña Meche',
];
const BOT_STEP_DELAY_MS = 2000;

interface StoredPlayer {
  id: string;
  name: string;
  seat: SeatIndex;
  isBot: boolean;
  connected: boolean;
}

interface ToastPayload {
  type: 'info' | 'success' | 'error';
  message: string;
}

interface StoredRoom {
  roomCode: string;
  hostId: string;
  phase: GamePhase;
  settings: RoomSettings;
  seats: (StoredPlayer | null)[];
  hands: Record<SeatIndex, Tile[]>;
  board: BoardState;
  currentTurn: SeatIndex | null;
  handNumber: number;
  scores: { A: number; B: number };
  history: HandResult[];
  lastAction: LastAction | null;
  lastHandResult: HandResult | null;
  matchWinner: TeamId | null;
  mustPlayDoubleSix: boolean;
  consecutivePasses: number;
  lastOpenerSeat: SeatIndex | null;
  passedSuitsBySeat: Record<SeatIndex, number[]>;
  partnerRotationStep: number;
  lastTurnAt: number;
  lastBroadcastToast?: (ToastPayload & { at: number }) | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function emptyHands(): Record<SeatIndex, Tile[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

function emptyPassedSuits(): Record<SeatIndex, number[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

function findPlayerSeat(room: StoredRoom, playerId: string): SeatIndex | null {
  for (const seat of SEATS) {
    if (room.seats[seat]?.id === playerId) return seat;
  }
  return null;
}

function syncSeatIndices(room: StoredRoom): void {
  for (const seat of SEATS) {
    const p = room.seats[seat];
    if (p) p.seat = seat;
  }
}

function buildClientState(
  room: StoredRoom,
  viewerSeat: SeatIndex | null
): ClientGameState {
  const isPlayingOrOver = room.phase !== 'lobby';
  const myHand =
    viewerSeat !== null && isPlayingOrOver
      ? room.hands[viewerSeat].map((t) => ({ ...t }))
      : [];

  const isMyTurn =
    room.phase === 'playing' &&
    viewerSeat !== null &&
    room.currentTurn === viewerSeat;

  const playableMoves = isMyTurn
    ? getPlayableMoves(myHand, room.board, room.mustPlayDoubleSix)
    : [];

  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    phase: room.phase,
    settings: { ...room.settings },
    players: SEATS.map((seat) => {
      const p = room.seats[seat];
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        isBot: p.isBot,
        connected: p.connected,
        tileCount: isPlayingOrOver ? room.hands[seat].length : 0,
      };
    }),
    mySeat: viewerSeat,
    myHand,
    playableMoves,
    board: {
      chain: room.board.chain.map((pt) => ({ ...pt, tile: { ...pt.tile } })),
      leftEnd: room.board.leftEnd,
      rightEnd: room.board.rightEnd,
      anchorIndex: room.board.anchorIndex,
    },
    currentTurn: room.currentTurn,
    handNumber: room.handNumber,
    scores: { ...room.scores },
    history: room.history,
    lastAction: room.lastAction ? { ...room.lastAction } : null,
    lastHandResult: room.lastHandResult,
    matchWinner: room.matchWinner,
    mustPlayDoubleSix: room.mustPlayDoubleSix,
  };
}

function startHand(
  room: StoredRoom,
  handNumber: number,
  previousResult: HandResult | null
): void {
  const hands = dealHands();
  const { opener, mustPlayDoubleSix } = determineOpener({
    handNumber,
    hands,
    previousWinnerSeat: previousResult?.winnerSeat ?? null,
    previousOpenerSeat: room.lastOpenerSeat,
    previousReason: previousResult?.reason ?? null,
  });

  room.phase = 'playing';
  room.handNumber = handNumber;
  room.hands = hands;
  room.board = createEmptyBoard();
  room.currentTurn = opener;
  room.mustPlayDoubleSix = mustPlayDoubleSix;
  room.consecutivePasses = 0;
  room.lastOpenerSeat = opener;
  room.passedSuitsBySeat = emptyPassedSuits();
  room.lastHandResult = null;
  room.lastTurnAt = Date.now();
  room.lastAction = {
    seat: opener,
    type: 'start',
    timestamp: Date.now(),
  };
}

function finishHand(room: StoredRoom, result: HandResult): void {
  room.scores = { ...result.cumulativeScores };
  room.history = [...room.history, result];
  room.lastHandResult = result;
  room.currentTurn = null;
  room.mustPlayDoubleSix = false;
  room.lastTurnAt = Date.now();

  const winner = getMatchWinner(room.scores, room.settings.targetScore);
  if (winner !== null) {
    room.matchWinner = winner;
    room.phase = 'match_over';
  } else {
    room.phase = 'hand_over';
  }
}

function executePlayTile(
  room: StoredRoom,
  seat: SeatIndex,
  tileId: string,
  side: 'left' | 'right'
): string | null {
  if (room.phase !== 'playing' || room.currentTurn !== seat) {
    return 'No es tu turno';
  }

  const hand = room.hands[seat];
  if (!isMoveValid(hand, room.board, tileId, side, room.mustPlayDoubleSix)) {
    return room.mustPlayDoubleSix
      ? 'Debes abrir la partida con la mula de 6 (6-6)'
      : 'Esa ficha no se puede colocar en ese lado';
  }

  const tileIndex = hand.findIndex((t) => t.id === tileId);
  if (tileIndex === -1) return 'No tienes esa ficha';

  const [tile] = hand.splice(tileIndex, 1);
  const boardBeforeMove = room.board;
  room.board = applyMove(room.board, tile, side, seat);
  room.mustPlayDoubleSix = false;
  room.consecutivePasses = 0;
  room.lastTurnAt = Date.now();
  room.lastAction = {
    seat,
    type: 'play',
    tile,
    side,
    timestamp: Date.now(),
  };

  if (hand.length === 0) {
    const isCapicu = isCapicuPlay(tile, boardBeforeMove);
    const result = resolveDominoWin({
      handNumber: room.handNumber,
      winnerSeat: seat,
      hands: room.hands,
      scoringMode: room.settings.scoringMode,
      currentScores: room.scores,
      capicuBonus: room.settings.capicuBonus,
      isCapicu,
    });
    if (room.settings.capicuBonus && isCapicu) {
      room.lastBroadcastToast = {
        type: 'success',
        message: '¡Capicú! +25 puntos extra',
        at: Date.now(),
      };
    }
    finishHand(room, result);
    return null;
  }

  if (isBoardClosed(room.hands, room.board)) {
    const closerName = room.seats[seat]?.name ?? `Asiento ${seat + 1}`;
    const result = resolveTrancado({
      handNumber: room.handNumber,
      hands: room.hands,
      scoringMode: room.settings.scoringMode,
      currentScores: room.scores,
    });
    room.lastBroadcastToast = {
      type: 'info',
      message: `¡Juego Cerrado! (${closerName} cerró la mesa)`,
      at: Date.now(),
    };
    finishHand(room, result);
    return null;
  }

  room.currentTurn = nextSeat(seat);
  return null;
}

function executePass(room: StoredRoom, seat: SeatIndex): string | null {
  if (room.phase !== 'playing' || room.currentTurn !== seat) {
    return 'No es tu turno';
  }

  const hand = room.hands[seat];
  if (!canPass(hand, room.board, room.mustPlayDoubleSix)) {
    return 'Tienes fichas jugables, no puedes pasar';
  }

  if (room.board.leftEnd !== null) {
    const set = new Set(room.passedSuitsBySeat[seat]);
    set.add(room.board.leftEnd);
    room.passedSuitsBySeat[seat] = [...set];
  }
  if (room.board.rightEnd !== null) {
    const set = new Set(room.passedSuitsBySeat[seat]);
    set.add(room.board.rightEnd);
    room.passedSuitsBySeat[seat] = [...set];
  }

  room.consecutivePasses += 1;
  room.lastTurnAt = Date.now();
  room.lastAction = {
    seat,
    type: 'pass',
    timestamp: Date.now(),
  };

  if (room.consecutivePasses >= 4) {
    const result = resolveTrancado({
      handNumber: room.handNumber,
      hands: room.hands,
      scoringMode: room.settings.scoringMode,
      currentScores: room.scores,
    });
    finishHand(room, result);
    return null;
  }

  room.currentTurn = nextSeat(seat);
  return null;
}

function advanceBotIfReady(room: StoredRoom): boolean {
  if (room.phase !== 'playing' || room.currentTurn === null) return false;
  const seat = room.currentTurn;
  const player = room.seats[seat];
  if (!player || !player.isBot) return false;
  if (Date.now() - room.lastTurnAt < BOT_STEP_DELAY_MS) return false;

  const passedSets: Record<SeatIndex, ReadonlySet<number>> = {
    0: new Set(room.passedSuitsBySeat[0]),
    1: new Set(room.passedSuitsBySeat[1]),
    2: new Set(room.passedSuitsBySeat[2]),
    3: new Set(room.passedSuitsBySeat[3]),
  };

  const decision = chooseBotMove({
    seat,
    hand: room.hands[seat],
    board: room.board,
    mustPlayDoubleSix: room.mustPlayDoubleSix,
    passedSuitsBySeat: passedSets,
    seatTileCounts: {
      0: room.hands[0].length,
      1: room.hands[1].length,
      2: room.hands[2].length,
      3: room.hands[3].length,
    },
  });

  if (decision.type === 'play') {
    executePlayTile(room, seat, decision.tileId, decision.side);
  } else {
    executePass(room, seat);
  }
  return true;
}

async function generateUniqueRoomCode(
  store: ReturnType<typeof getStore>
): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      code += ROOM_CODE_ALPHABET[idx];
    }
    const existing = await store.get(code, { type: 'json', consistency: 'strong' });
    if (!existing) return code;
  }
  throw new Error('No se pudo generar un código de mesa único');
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: {
    action?: string;
    playerId?: string;
    roomCode?: string;
    payload?: Record<string, unknown>;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(
      { toast: { type: 'error', message: 'Solicitud inválida' } },
      400
    );
  }

  const action = body.action ?? '';
  const playerId = (body.playerId ?? '').trim();
  const payload = body.payload ?? {};
  const store = getStore(STORE_NAME);

  if (action === 'room:create') {
    const rawName = String(payload.playerName ?? '').trim();
    const pid = String(payload.playerId ?? playerId).trim();
    if (!rawName || !pid) {
      return jsonResponse({
        toast: { type: 'error', message: 'Escribe tu nombre para crear la mesa' },
      });
    }

    const roomCode = await generateUniqueRoomCode(store);
    const room: StoredRoom = {
      roomCode,
      hostId: pid,
      phase: 'lobby',
      settings: { targetScore: 100, scoringMode: 'opponents_only', capicuBonus: false },
      seats: [
        {
          id: pid,
          name: rawName.slice(0, 24),
          seat: 0,
          isBot: false,
          connected: true,
        },
        null,
        null,
        null,
      ],
      hands: emptyHands(),
      board: createEmptyBoard(),
      currentTurn: null,
      handNumber: 0,
      scores: { A: 0, B: 0 },
      history: [],
      lastAction: null,
      lastHandResult: null,
      matchWinner: null,
      mustPlayDoubleSix: false,
      consecutivePasses: 0,
      lastOpenerSeat: null,
      passedSuitsBySeat: emptyPassedSuits(),
      partnerRotationStep: 0,
      lastTurnAt: Date.now(),
      lastBroadcastToast: null,
    };

    await store.setJSON(roomCode, room);
    return jsonResponse({
      state: buildClientState(room, 0),
      toast: { type: 'success', message: `Mesa ${roomCode} creada` },
    });
  }

  const code = String(payload.roomCode ?? body.roomCode ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (code.length !== 4) {
    return jsonResponse({
      toast: { type: 'error', message: 'Código de mesa inválido' },
    });
  }

  const room = (await store.get(code, {
    type: 'json',
    consistency: 'strong',
  })) as StoredRoom | null;

  if (!room) {
    return jsonResponse({
      toast: { type: 'error', message: `La mesa ${code} no existe o ya terminó` },
    });
  }

  if (action === 'room:join') {
    const rawName = String(payload.playerName ?? '').trim();
    const pid = String(payload.playerId ?? playerId).trim();
    if (!rawName || !pid) {
      return jsonResponse({
        toast: { type: 'error', message: 'Escribe tu nombre antes de entrar' },
      });
    }

    const existingSeat = findPlayerSeat(room, pid);
    if (existingSeat !== null) {
      const existing = room.seats[existingSeat]!;
      existing.connected = true;
      existing.name = rawName.slice(0, 24);
      await store.setJSON(code, room);
      return jsonResponse({
        state: buildClientState(room, existingSeat),
        toast: { type: 'info', message: `Reconectado a la mesa ${code}` },
      });
    }

    let targetSeat: SeatIndex | null = null;
    for (const s of SEATS) {
      if (room.seats[s] === null) {
        targetSeat = s;
        break;
      }
    }
    if (targetSeat === null && room.phase === 'lobby') {
      for (const s of SEATS) {
        if (room.seats[s]?.isBot) {
          targetSeat = s;
          break;
        }
      }
    }

    if (targetSeat === null) {
      return jsonResponse({
        toast: { type: 'error', message: 'La mesa ya está llena (4 jugadores)' },
      });
    }

    room.seats[targetSeat] = {
      id: pid,
      name: rawName.slice(0, 24),
      seat: targetSeat,
      isBot: false,
      connected: true,
    };

    await store.setJSON(code, room);
    return jsonResponse({
      state: buildClientState(room, targetSeat),
      toast: { type: 'success', message: `Te sentaste en la mesa ${code}` },
    });
  }

  const seat = findPlayerSeat(room, playerId);
  if (seat === null) {
    return jsonResponse({
      toast: { type: 'error', message: 'No estás sentado en esta mesa' },
    });
  }

  let toast: ToastPayload | undefined;
  let dirty = false;

  if (action === 'room:state') {
    if (advanceBotIfReady(room)) {
      dirty = true;
    }
    if (
      room.lastBroadcastToast &&
      Date.now() - room.lastBroadcastToast.at <= 3000
    ) {
      toast = {
        type: room.lastBroadcastToast.type,
        message: room.lastBroadcastToast.message,
      };
    }
  } else if (action === 'room:update_settings') {
    if (room.hostId !== playerId) {
      toast = { type: 'error', message: 'Solo el anfitrión puede cambiar la configuración' };
    } else if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      toast = { type: 'error', message: 'No puedes cambiar reglas a mitad de la partida' };
    } else {
      const targetScore = payload.targetScore;
      if (targetScore === 100 || targetScore === 150 || targetScore === 200) {
        room.settings.targetScore = targetScore;
      }
      const scoringMode = payload.scoringMode;
      if (scoringMode === 'all_remaining' || scoringMode === 'opponents_only') {
        room.settings.scoringMode = scoringMode;
      }
      if (typeof payload.capicuBonus === 'boolean') {
        room.settings.capicuBonus = payload.capicuBonus;
      }
      dirty = true;
    }
  } else if (action === 'room:swap_seat') {
    const targetSeat = payload.targetSeat as SeatIndex;
    if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      toast = { type: 'error', message: 'Solo puedes cambiar asientos en el lobby o al terminar la partida' };
    } else if (SEATS.includes(targetSeat) && targetSeat !== seat) {
      const current = room.seats[seat];
      const target = room.seats[targetSeat];
      room.seats[targetSeat] = current;
      room.seats[seat] = target;
      syncSeatIndices(room);
      dirty = true;
    }
  } else if (action === 'room:swap_two_seats') {
    const seatA = payload.seatA as SeatIndex;
    const seatB = payload.seatB as SeatIndex;
    if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      toast = { type: 'error', message: 'Solo puedes cambiar parejas en el lobby o al terminar la partida' };
    } else if (SEATS.includes(seatA) && SEATS.includes(seatB) && seatA !== seatB) {
      const a = room.seats[seatA];
      const b = room.seats[seatB];
      room.seats[seatA] = b;
      room.seats[seatB] = a;
      syncSeatIndices(room);
      dirty = true;
    }
  } else if (action === 'room:rotate_partners') {
    if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      toast = { type: 'error', message: 'Solo puedes rotar parejas en el lobby o al terminar la partida' };
    } else {
      const step = room.partnerRotationStep % 2;
      if (step === 0) {
        [room.seats[1], room.seats[2]] = [room.seats[2], room.seats[1]];
      } else {
        [room.seats[2], room.seats[3]] = [room.seats[3], room.seats[2]];
      }
      room.partnerRotationStep += 1;
      syncSeatIndices(room);
      toast = { type: 'info', message: 'Parejas rotadas' };
      dirty = true;
    }
  } else if (action === 'room:randomize_partners') {
    if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      toast = { type: 'error', message: 'Solo puedes sortear parejas en el lobby o al terminar la partida' };
    } else {
      const arr = [...room.seats];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      room.seats = arr;
      syncSeatIndices(room);
      toast = { type: 'info', message: 'Parejas sorteadas al azar' };
      dirty = true;
    }
  } else if (action === 'room:fill_bots') {
    if (room.phase !== 'lobby') {
      toast = { type: 'error', message: 'Solo puedes agregar bots en el lobby' };
    } else {
      const usedNames = new Set(
        room.seats.filter((p): p is StoredPlayer => p !== null).map((p) => p.name)
      );
      let botSeq = 1;
      let added = 0;
      for (const s of SEATS) {
        if (room.seats[s] === null) {
          const name =
            BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${botSeq++}`;
          usedNames.add(name);
          room.seats[s] = {
            id: `bot_${room.roomCode}_${s}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            seat: s,
            isBot: true,
            connected: true,
          };
          added++;
        }
      }
      if (added > 0) {
        toast = { type: 'success', message: `${added} bot(s) sentados en la mesa` };
        dirty = true;
      }
    }
  } else if (action === 'room:remove_bot') {
    const target = payload.seat as SeatIndex;
    if (room.phase === 'lobby' && SEATS.includes(target) && room.seats[target]?.isBot) {
      room.seats[target] = null;
      dirty = true;
    }
  } else if (action === 'room:start_match') {
    if (room.hostId !== playerId) {
      toast = { type: 'error', message: 'Solo el anfitrión puede iniciar la partida' };
    } else if (room.phase !== 'lobby') {
      toast = { type: 'error', message: 'La partida ya está en curso' };
    } else if (!SEATS.every((s) => room.seats[s] !== null)) {
      toast = { type: 'error', message: 'Se necesitan 4 jugadores (o bots) para iniciar' };
    } else {
      room.scores = { A: 0, B: 0 };
      room.history = [];
      room.matchWinner = null;
      room.lastOpenerSeat = null;
      startHand(room, 1, null);
      dirty = true;
    }
  } else if (action === 'game:play_tile') {
    const err = executePlayTile(
      room,
      seat,
      String(payload.tileId ?? ''),
      payload.side === 'right' ? 'right' : 'left'
    );
    if (err) {
      toast = { type: 'error', message: err };
    } else {
      dirty = true;
      if (
        room.lastBroadcastToast &&
        Date.now() - room.lastBroadcastToast.at <= 3000
      ) {
        toast = {
          type: room.lastBroadcastToast.type,
          message: room.lastBroadcastToast.message,
        };
      }
    }
  } else if (action === 'game:pass') {
    const err = executePass(room, seat);
    if (err) {
      toast = { type: 'error', message: err };
    } else {
      dirty = true;
    }
  } else if (action === 'game:next_hand') {
    if (room.phase === 'hand_over') {
      startHand(room, room.handNumber + 1, room.lastHandResult);
      dirty = true;
    }
  } else if (action === 'game:rematch') {
    if (room.phase === 'match_over' || room.phase === 'hand_over') {
      if (!SEATS.every((s) => room.seats[s] !== null)) {
        toast = { type: 'error', message: 'Se necesitan 4 jugadores para la revancha' };
      } else {
        room.scores = { A: 0, B: 0 };
        room.history = [];
        room.matchWinner = null;
        room.lastOpenerSeat = null;
        startHand(room, 1, null);
        dirty = true;
      }
    }
  } else if (action === 'game:return_to_lobby') {
    if (room.phase !== 'lobby') {
      room.phase = 'lobby';
      room.hands = emptyHands();
      room.board = createEmptyBoard();
      room.currentTurn = null;
      room.handNumber = 0;
      room.scores = { A: 0, B: 0 };
      room.history = [];
      room.lastAction = null;
      room.lastHandResult = null;
      room.matchWinner = null;
      room.mustPlayDoubleSix = false;
      room.consecutivePasses = 0;
      room.lastOpenerSeat = null;
      room.passedSuitsBySeat = emptyPassedSuits();
      dirty = true;
    }
  }

  if (dirty) {
    await store.setJSON(code, room);
  }

  const updatedSeat = findPlayerSeat(room, playerId);
  return jsonResponse({
    state: buildClientState(room, updatedSeat),
    ...(toast ? { toast } : {}),
  });
};
