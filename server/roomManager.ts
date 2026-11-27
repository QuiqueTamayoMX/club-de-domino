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
} from '../shared/dominoEngine.ts';
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
} from '../shared/types.ts';
import { chooseBotMove } from './botAI.ts';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = [
  'Don Beto',
  'Doña Lupe',
  'El Güero',
  'La Chata',
  'Don Pepe',
  'Doña Meche',
];

const BOT_DELAY_MIN_MS = 1900;
const BOT_DELAY_MAX_MS = 2300;
const HOST_GRACE_MS = 20_000;

interface InternalPlayer {
  id: string;
  name: string;
  seat: SeatIndex;
  isBot: boolean;
  connected: boolean;
  socketId: string | null;
}

interface InternalRoom {
  roomCode: string;
  hostId: string;
  phase: GamePhase;
  settings: RoomSettings;
  seats: (InternalPlayer | null)[];
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
  currentOpenerSeat: SeatIndex | null;
  passedSuitsBySeat: Record<SeatIndex, Set<number>>;
  botTimer: NodeJS.Timeout | null;
  hostGraceTimer: NodeJS.Timeout | null;
}

export interface RoomNotifier {
  sendState: (socketId: string, state: ClientGameState) => void;
  sendToast: (
    socketId: string,
    payload: { type: 'info' | 'success' | 'error'; message: string }
  ) => void;
}

interface SocketSession {
  roomCode: string;
  playerId: string;
}

function emptyHandsRecord(): Record<SeatIndex, Tile[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

function emptyPassedSuits(): Record<SeatIndex, Set<number>> {
  return {
    0: new Set<number>(),
    1: new Set<number>(),
    2: new Set<number>(),
    3: new Set<number>(),
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketSessions = new Map<string, SocketSession>();
  private readonly notifier: RoomNotifier;

  constructor(notifier: RoomNotifier) {
    this.notifier = notifier;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[idx];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Failed to generate unique room code');
  }

  private clearBotTimer(room: InternalRoom): void {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
  }

  private clearHostGraceTimer(room: InternalRoom): void {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
  }

  private disposeRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    this.clearBotTimer(room);
    this.clearHostGraceTimer(room);
    this.rooms.delete(roomCode);
  }

  private findPlayerSeat(room: InternalRoom, playerId: string): SeatIndex | null {
    for (const seat of SEATS) {
      if (room.seats[seat]?.id === playerId) {
        return seat;
      }
    }
    return null;
  }

  private promoteNextHumanHost(room: InternalRoom): boolean {
    const currentHost = room.seats.find((p) => p?.id === room.hostId) ?? null;
    if (currentHost && !currentHost.isBot && currentHost.connected) {
      return false;
    }

    const nextConnectedHuman = room.seats.find(
      (p) => p !== null && !p.isBot && p.connected
    );
    if (nextConnectedHuman) {
      room.hostId = nextConnectedHuman.id;
      this.broadcastToast(room, {
        type: 'info',
        message: `${nextConnectedHuman.name} ahora es el anfitrión`,
      });
      return true;
    }

    const nextAnyHuman = room.seats.find((p) => p !== null && !p.isBot);
    if (nextAnyHuman && nextAnyHuman.id !== room.hostId) {
      room.hostId = nextAnyHuman.id;
      return true;
    }

    return false;
  }

  private buildClientState(
    room: InternalRoom,
    viewerSeat: SeatIndex | null
  ): ClientGameState {
    const isPlayingOrOver = room.phase !== 'lobby';
    const myHand =
      viewerSeat !== null && isPlayingOrOver
        ? room.hands[viewerSeat].map((t) => ({ ...t }))
        : [];

    const playableMoves =
      room.phase === 'playing' &&
      viewerSeat !== null &&
      room.currentTurn === viewerSeat
        ? getPlayableMoves(
            room.hands[viewerSeat],
            room.board,
            room.mustPlayDoubleSix
          )
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
          seat,
          isBot: p.isBot,
          connected: p.connected,
          tileCount: isPlayingOrOver ? room.hands[seat].length : 0,
        };
      }),
      mySeat: viewerSeat,
      myHand,
      playableMoves,
      board: {
        chain: room.board.chain.map((placed) => ({
          ...placed,
          tile: { ...placed.tile },
        })),
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

  private broadcastState(room: InternalRoom): void {
    for (const seat of SEATS) {
      const player = room.seats[seat];
      if (player && !player.isBot && player.connected && player.socketId) {
        this.notifier.sendState(
          player.socketId,
          this.buildClientState(room, seat)
        );
      }
    }
  }

  private broadcastToast(
    room: InternalRoom,
    payload: { type: 'info' | 'success' | 'error'; message: string },
    excludeSocketId?: string
  ): void {
    for (const seat of SEATS) {
      const player = room.seats[seat];
      if (
        player &&
        !player.isBot &&
        player.connected &&
        player.socketId &&
        player.socketId !== excludeSocketId
      ) {
        this.notifier.sendToast(player.socketId, payload);
      }
    }
  }

  private sendError(socketId: string, message: string): void {
    this.notifier.sendToast(socketId, { type: 'error', message });
  }

  private getSessionContext(
    socketId: string
  ): { room: InternalRoom; player: InternalPlayer; seat: SeatIndex } | null {
    const session = this.socketSessions.get(socketId);
    if (!session) {
      this.sendError(socketId, 'No estás conectado a ninguna mesa');
      return null;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room) {
      this.socketSessions.delete(socketId);
      this.sendError(socketId, 'La mesa ya no existe');
      return null;
    }
    const seat = this.findPlayerSeat(room, session.playerId);
    if (seat === null) {
      this.socketSessions.delete(socketId);
      this.sendError(socketId, 'No ocupas un asiento en esta mesa');
      return null;
    }
    const player = room.seats[seat];
    if (!player) return null;
    return { room, player, seat };
  }

  /**
   * Removes or detaches a socket from its previous room when joining/creating a new one.
   */
  private leavePreviousRoom(socketId: string, nextRoomCode?: string): void {
    const session = this.socketSessions.get(socketId);
    if (!session || session.roomCode === nextRoomCode) return;

    const oldRoom = this.rooms.get(session.roomCode);
    this.socketSessions.delete(socketId);
    if (!oldRoom) return;

    const seat = this.findPlayerSeat(oldRoom, session.playerId);
    if (seat === null) return;

    const player = oldRoom.seats[seat];
    if (!player) return;

    if (oldRoom.phase === 'lobby') {
      oldRoom.seats[seat] = null;
    } else {
      player.connected = false;
      player.socketId = null;
    }

    const anyHumansLeft = oldRoom.seats.some((p) => p !== null && !p.isBot);
    if (!anyHumansLeft) {
      this.disposeRoom(oldRoom.roomCode);
      return;
    }

    if (oldRoom.hostId === session.playerId) {
      this.promoteNextHumanHost(oldRoom);
    }
    this.broadcastState(oldRoom);
  }

  createRoom(
    socketId: string,
    payload: { playerName: string; playerId: string }
  ): void {
    const playerId = payload.playerId?.trim();
    const playerName = payload.playerName?.trim() || 'Jugador 1';
    if (!playerId) {
      this.sendError(socketId, 'Identificador de jugador inválido');
      return;
    }

    this.leavePreviousRoom(socketId);

    const roomCode = this.generateRoomCode();
    const creator: InternalPlayer = {
      id: playerId,
      name: playerName.slice(0, 24),
      seat: 0,
      isBot: false,
      connected: true,
      socketId,
    };

    const room: InternalRoom = {
      roomCode,
      hostId: playerId,
      phase: 'lobby',
      settings: { targetScore: 100, scoringMode: 'opponents_only', capicuBonus: false },
      seats: [creator, null, null, null],
      hands: emptyHandsRecord(),
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
      currentOpenerSeat: null,
      passedSuitsBySeat: emptyPassedSuits(),
      botTimer: null,
      hostGraceTimer: null,
    };

    this.rooms.set(roomCode, room);
    this.socketSessions.set(socketId, { roomCode, playerId });
    this.broadcastState(room);
  }

  joinRoom(
    socketId: string,
    payload: { roomCode: string; playerName: string; playerId: string }
  ): void {
    const roomCode = payload.roomCode?.trim().toUpperCase();
    const playerId = payload.playerId?.trim();
    const playerName = payload.playerName?.trim() || 'Jugador';

    if (!roomCode || !playerId) {
      this.sendError(socketId, 'Código de mesa o jugador inválido');
      return;
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.sendError(socketId, `No existe la mesa ${roomCode}`);
      return;
    }

    this.leavePreviousRoom(socketId, roomCode);

    // Check for seamless reconnection by playerId
    const existingSeat = this.findPlayerSeat(room, playerId);
    if (existingSeat !== null) {
      const existing = room.seats[existingSeat]!;
      existing.connected = true;
      existing.socketId = socketId;
      if (payload.playerName?.trim()) {
        existing.name = payload.playerName.trim().slice(0, 24);
      }
      if (room.hostId === playerId) {
        this.clearHostGraceTimer(room);
      }
      this.socketSessions.set(socketId, { roomCode, playerId });
      this.broadcastState(room);
      this.notifier.sendToast(socketId, {
        type: 'success',
        message: `Reconectado a la mesa ${roomCode}`,
      });
      this.broadcastToast(
        room,
        { type: 'info', message: `${existing.name} volvió a la mesa` },
        socketId
      );
      return;
    }

    if (room.phase !== 'lobby') {
      this.sendError(socketId, 'La partida ya comenzó en esta mesa');
      return;
    }

    const openSeat = SEATS.find((seat) => room.seats[seat] === null);
    if (openSeat === undefined) {
      this.sendError(socketId, 'La mesa está llena (4/4 jugadores)');
      return;
    }

    const newPlayer: InternalPlayer = {
      id: playerId,
      name: playerName.slice(0, 24),
      seat: openSeat,
      isBot: false,
      connected: true,
      socketId,
    };

    room.seats[openSeat] = newPlayer;
    this.socketSessions.set(socketId, { roomCode, playerId });

    // If current host was disconnected/gone, ensure an active host exists
    const currentHost = room.seats.find((p) => p?.id === room.hostId);
    if (!currentHost) {
      room.hostId = playerId;
    }

    this.broadcastState(room);
    this.broadcastToast(
      room,
      { type: 'info', message: `${newPlayer.name} se unió a la mesa` },
      socketId
    );
  }

  handleDisconnect(socketId: string): void {
    const session = this.socketSessions.get(socketId);
    if (!session) return;
    this.socketSessions.delete(socketId);

    const room = this.rooms.get(session.roomCode);
    if (!room) return;

    const seat = this.findPlayerSeat(room, session.playerId);
    if (seat === null) return;

    const player = room.seats[seat];
    if (!player || player.socketId !== socketId) {
      // Player already reconnected on a newer socket
      return;
    }

    player.connected = false;
    player.socketId = null;

    if (room.hostId === player.id) {
      this.clearHostGraceTimer(room);
      room.hostGraceTimer = setTimeout(() => {
        room.hostGraceTimer = null;
        const stillDisconnected =
          room.seats.find((p) => p?.id === player.id)?.connected === false;
        if (stillDisconnected) {
          if (this.promoteNextHumanHost(room)) {
            this.broadcastState(room);
          }
        }
      }, HOST_GRACE_MS);
    }

    this.broadcastState(room);
  }

  updateSettings(socketId: string, payload: Partial<RoomSettings>): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room, player } = ctx;

    if (room.hostId !== player.id) {
      this.sendError(socketId, 'Solo el anfitrión puede cambiar la configuración');
      return;
    }
    if (room.phase !== 'lobby' && room.phase !== 'match_over') {
      this.sendError(socketId, 'No puedes cambiar reglas a mitad de la partida');
      return;
    }

    if (
      payload.targetScore === 100 ||
      payload.targetScore === 150 ||
      payload.targetScore === 200
    ) {
      room.settings.targetScore = payload.targetScore;
    }
    if (
      payload.scoringMode === 'all_remaining' ||
      payload.scoringMode === 'opponents_only'
    ) {
      room.settings.scoringMode = payload.scoringMode;
    }
    if (typeof payload.capicuBonus === 'boolean') {
      room.settings.capicuBonus = payload.capicuBonus;
    }

    this.broadcastState(room);
  }

  private canModifySeats(room: InternalRoom): boolean {
    return room.phase === 'lobby' || room.phase === 'match_over';
  }

  private syncSeatIndices(room: InternalRoom): void {
    for (const seat of SEATS) {
      const p = room.seats[seat];
      if (p) p.seat = seat;
    }
  }

  swapSeat(socketId: string, payload: { targetSeat: SeatIndex }): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room, seat } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden cambiar asientos en el lobby o al terminar');
      return;
    }

    const targetSeat = payload.targetSeat;
    if (!SEATS.includes(targetSeat) || targetSeat === seat) return;

    const movingPlayer = room.seats[seat];
    const occupant = room.seats[targetSeat];
    room.seats[targetSeat] = movingPlayer;
    room.seats[seat] = occupant;
    this.syncSeatIndices(room);
    this.broadcastState(room);
  }

  swapTwoSeats(
    socketId: string,
    payload: { seatA: SeatIndex; seatB: SeatIndex }
  ): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden cambiar parejas en el lobby o al terminar');
      return;
    }

    const { seatA, seatB } = payload;
    if (!SEATS.includes(seatA) || !SEATS.includes(seatB) || seatA === seatB) {
      return;
    }

    const temp = room.seats[seatA];
    room.seats[seatA] = room.seats[seatB];
    room.seats[seatB] = temp;
    this.syncSeatIndices(room);
    this.broadcastState(room);
  }

  /**
   * Cycles cleanly through all 3 possible partner pairings:
   * (0,2 vs 1,3) -> (0,3 vs 1,2) -> (0,1 vs 2,3) -> (0,2 vs 1,3).
   */
  rotatePartners(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden rotar parejas en el lobby o al terminar');
      return;
    }

    const s1 = room.seats[1];
    const s2 = room.seats[2];
    const s3 = room.seats[3];
    room.seats[1] = s2;
    room.seats[2] = s3;
    room.seats[3] = s1;
    this.syncSeatIndices(room);
    this.broadcastState(room);
  }

  randomizePartners(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden mezclar parejas en el lobby o al terminar');
      return;
    }

    const occupied = room.seats.filter((p): p is InternalPlayer => p !== null);
    if (occupied.length < 2) return;

    // Fisher-Yates shuffle across all 4 seats (or occupied seats)
    const seatPool: (InternalPlayer | null)[] = [...room.seats];
    for (let i = seatPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seatPool[i], seatPool[j]] = [seatPool[j], seatPool[i]];
    }
    room.seats = seatPool;
    this.syncSeatIndices(room);
    this.broadcastState(room);
  }

  fillBots(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden agregar bots en el lobby');
      return;
    }

    const usedNames = new Set(
      room.seats.filter((p): p is InternalPlayer => p !== null).map((p) => p.name)
    );
    const availableNames = BOT_NAMES.filter((name) => !usedNames.has(name));

    let added = 0;
    for (const seat of SEATS) {
      if (room.seats[seat] === null) {
        const botName =
          availableNames.shift() ?? `Bot ${seat + 1}`;
        room.seats[seat] = {
          id: `bot-${room.roomCode}-${seat}-${Date.now()}`,
          name: botName,
          seat,
          isBot: true,
          connected: true,
          socketId: null,
        };
        added++;
      }
    }

    if (added > 0) {
      this.broadcastState(room);
    }
  }

  removeBot(socketId: string, payload: { seat: SeatIndex }): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (!this.canModifySeats(room)) {
      this.sendError(socketId, 'Solo se pueden quitar bots en el lobby');
      return;
    }

    const target = room.seats[payload.seat];
    if (!target || !target.isBot) return;

    room.seats[payload.seat] = null;
    this.broadcastState(room);
  }

  startMatch(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (room.phase !== 'lobby') {
      this.sendError(socketId, 'La partida ya está en curso');
      return;
    }

    if (SEATS.some((seat) => room.seats[seat] === null)) {
      this.sendError(
        socketId,
        'Se necesitan 4 jugadores para iniciar (usa "Llenar con Bots")'
      );
      return;
    }

    this.beginNewMatch(room);
  }

  rematch(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (room.phase !== 'match_over') {
      this.sendError(socketId, 'La partida aún no ha terminado');
      return;
    }

    if (SEATS.some((seat) => room.seats[seat] === null)) {
      this.sendError(socketId, 'Se necesitan 4 jugadores para la revancha');
      return;
    }

    this.beginNewMatch(room);
  }

  returnToLobby(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    this.clearBotTimer(room);
    room.phase = 'lobby';
    room.hands = emptyHandsRecord();
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
    room.currentOpenerSeat = null;
    room.passedSuitsBySeat = emptyPassedSuits();

    this.broadcastState(room);
  }

  nextHand(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room } = ctx;

    if (room.phase !== 'hand_over') {
      this.sendError(socketId, 'No hay una mano terminada lista para continuar');
      return;
    }

    this.startHand(room);
  }

  playTile(
    socketId: string,
    payload: { tileId: string; side: 'left' | 'right' }
  ): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room, seat } = ctx;

    if (room.phase !== 'playing') {
      this.sendError(socketId, 'La mano no está activa');
      return;
    }
    if (room.currentTurn !== seat) {
      this.sendError(socketId, 'No es tu turno');
      return;
    }

    const error = this.executePlayTile(room, seat, payload.tileId, payload.side);
    if (error) {
      this.sendError(socketId, error);
    }
  }

  passTurn(socketId: string): void {
    const ctx = this.getSessionContext(socketId);
    if (!ctx) return;
    const { room, seat } = ctx;

    if (room.phase !== 'playing') {
      this.sendError(socketId, 'La mano no está activa');
      return;
    }
    if (room.currentTurn !== seat) {
      this.sendError(socketId, 'No es tu turno');
      return;
    }

    const error = this.executePass(room, seat);
    if (error) {
      this.sendError(socketId, error);
    }
  }

  private beginNewMatch(room: InternalRoom): void {
    this.clearBotTimer(room);
    room.scores = { A: 0, B: 0 };
    room.history = [];
    room.handNumber = 0;
    room.lastHandResult = null;
    room.matchWinner = null;
    room.currentOpenerSeat = null;
    this.startHand(room);
  }

  private startHand(room: InternalRoom): void {
    this.clearBotTimer(room);
    room.handNumber += 1;
    room.hands = dealHands();
    room.board = createEmptyBoard();
    room.consecutivePasses = 0;
    room.passedSuitsBySeat = emptyPassedSuits();

    const { opener, mustPlayDoubleSix } = determineOpener({
      handNumber: room.handNumber,
      hands: room.hands,
      previousWinnerSeat: room.lastHandResult?.winnerSeat ?? null,
      previousOpenerSeat: room.currentOpenerSeat,
      previousReason: room.lastHandResult?.reason ?? null,
    });

    room.currentOpenerSeat = opener;
    room.currentTurn = opener;
    room.mustPlayDoubleSix = mustPlayDoubleSix;
    room.phase = 'playing';
    room.lastAction = {
      seat: opener,
      type: 'start',
      timestamp: Date.now(),
    };

    this.broadcastState(room);
    this.scheduleBotTurnIfNeeded(room);
  }

  private executePlayTile(
    room: InternalRoom,
    seat: SeatIndex,
    tileId: string,
    side: 'left' | 'right'
  ): string | null {
    const hand = room.hands[seat];
    if (!isMoveValid(hand, room.board, tileId, side, room.mustPlayDoubleSix)) {
      return room.mustPlayDoubleSix
        ? 'Debes abrir la partida con la mula de 6 (6-6)'
        : 'Esa ficha no se puede colocar en ese lado';
    }

    const tileIndex = hand.findIndex((t) => t.id === tileId);
    if (tileIndex === -1) {
      return 'No tienes esa ficha';
    }

    const [tile] = hand.splice(tileIndex, 1);
    const boardBeforeMove = room.board;
    room.board = applyMove(room.board, tile, side, seat);
    room.mustPlayDoubleSix = false;
    room.consecutivePasses = 0;
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
        this.broadcastToast(room, {
          type: 'success',
          message: '¡Capicú! +25 puntos extra',
        });
      }
      this.finishHand(room, result);
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
      this.broadcastToast(room, {
        type: 'info',
        message: `¡Juego Cerrado! (${closerName} cerró la mesa)`,
      });
      this.finishHand(room, result);
      return null;
    }

    room.currentTurn = nextSeat(seat);
    this.broadcastState(room);
    this.scheduleBotTurnIfNeeded(room);
    return null;
  }

  private executePass(room: InternalRoom, seat: SeatIndex): string | null {
    const hand = room.hands[seat];
    if (!canPass(hand, room.board, room.mustPlayDoubleSix)) {
      return 'Tienes fichas jugables, no puedes pasar';
    }

    if (room.board.leftEnd !== null) {
      room.passedSuitsBySeat[seat].add(room.board.leftEnd);
    }
    if (room.board.rightEnd !== null) {
      room.passedSuitsBySeat[seat].add(room.board.rightEnd);
    }

    room.consecutivePasses += 1;
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
      this.finishHand(room, result);
      return null;
    }

    room.currentTurn = nextSeat(seat);
    this.broadcastState(room);
    this.scheduleBotTurnIfNeeded(room);
    return null;
  }

  private finishHand(room: InternalRoom, result: HandResult): void {
    this.clearBotTimer(room);
    room.scores = { ...result.cumulativeScores };
    room.history = [...room.history, result];
    room.lastHandResult = result;
    room.currentTurn = null;
    room.mustPlayDoubleSix = false;

    const winner = getMatchWinner(room.scores, room.settings.targetScore);
    if (winner !== null) {
      room.matchWinner = winner;
      room.phase = 'match_over';
    } else {
      room.phase = 'hand_over';
    }

    this.broadcastState(room);
  }

  private scheduleBotTurnIfNeeded(room: InternalRoom): void {
    this.clearBotTimer(room);

    if (room.phase !== 'playing' || room.currentTurn === null) {
      return;
    }

    const turnSeat = room.currentTurn;
    const currentPlayer = room.seats[turnSeat];
    if (!currentPlayer || !currentPlayer.isBot) {
      return;
    }

    const delay =
      BOT_DELAY_MIN_MS +
      Math.floor(Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS + 1));

    room.botTimer = setTimeout(() => {
      room.botTimer = null;

      if (
        !this.rooms.has(room.roomCode) ||
        room.phase !== 'playing' ||
        room.currentTurn !== turnSeat
      ) {
        return;
      }
      const botPlayer = room.seats[turnSeat];
      if (!botPlayer || !botPlayer.isBot) {
        return;
      }

      const seatTileCounts: Record<SeatIndex, number> = {
        0: room.hands[0].length,
        1: room.hands[1].length,
        2: room.hands[2].length,
        3: room.hands[3].length,
      };

      const decision = chooseBotMove({
        seat: turnSeat,
        hand: room.hands[turnSeat],
        board: room.board,
        mustPlayDoubleSix: room.mustPlayDoubleSix,
        passedSuitsBySeat: room.passedSuitsBySeat,
        seatTileCounts,
      });

      if (decision.type === 'play') {
        this.executePlayTile(room, turnSeat, decision.tileId, decision.side);
      } else {
        this.executePass(room, turnSeat);
      }
    }, delay);
  }
}
