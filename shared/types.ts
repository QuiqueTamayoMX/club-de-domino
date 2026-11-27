export type SeatIndex = 0 | 1 | 2 | 3;

export type TeamId = 'A' | 'B'; // 0 & 2 => 'A' (Sur/Norte), 1 & 3 => 'B' (Este/Oeste)

export type Tile = {
  id: string;
  a: number;
  b: number;
}; // a <= b, id = "${a}-${b}"

export type PlacedTile = {
  tile: Tile;
  leftValue: number;
  rightValue: number;
  isDouble: boolean;
  playedBy: SeatIndex;
};

export type BoardState = {
  chain: PlacedTile[];
  leftEnd: number | null;
  rightEnd: number | null;
  anchorIndex: number;
};

export type RoomSettings = {
  targetScore: 100 | 150 | 200;
  scoringMode: 'all_remaining' | 'opponents_only';
  capicuBonus: boolean;
};

export type Player = {
  id: string;
  name: string;
  seat: SeatIndex;
  isBot: boolean;
  connected: boolean;
  tileCount: number;
};

export type HandResult = {
  handNumber: number;
  winnerTeam: TeamId | null;
  winnerSeat: SeatIndex | null;
  reason: 'domino' | 'trancado' | 'trancado_tie';
  pointsAwarded: number;
  isCapicu?: boolean;
  remainingHands: Record<SeatIndex, Tile[]>;
  teamPipTotals: { A: number; B: number };
  cumulativeScores: { A: number; B: number };
};

export type GamePhase = 'lobby' | 'playing' | 'hand_over' | 'match_over';

export type LastAction = {
  seat: SeatIndex;
  type: 'play' | 'pass' | 'start';
  tile?: Tile;
  side?: 'left' | 'right';
  timestamp: number;
};

export type PlayableMove = {
  tileId: string;
  sides: ('left' | 'right')[];
};

export type ClientGameState = {
  roomCode: string;
  hostId: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: (Player | null)[];
  mySeat: SeatIndex | null;
  myHand: Tile[];
  playableMoves: PlayableMove[];
  board: BoardState;
  currentTurn: SeatIndex | null;
  handNumber: number;
  scores: { A: number; B: number };
  history: HandResult[];
  lastAction: LastAction | null;
  lastHandResult: HandResult | null;
  matchWinner: TeamId | null;
  mustPlayDoubleSix: boolean;
};

export interface ClientToServerEvents {
  'room:create': (payload: { playerName: string; playerId: string }) => void;
  'room:join': (payload: { roomCode: string; playerName: string; playerId: string }) => void;
  'room:update_settings': (payload: Partial<RoomSettings>) => void;
  'room:swap_seat': (payload: { targetSeat: SeatIndex }) => void;
  'room:swap_two_seats': (payload: { seatA: SeatIndex; seatB: SeatIndex }) => void;
  'room:rotate_partners': () => void;
  'room:randomize_partners': () => void;
  'room:fill_bots': () => void;
  'room:remove_bot': (payload: { seat: SeatIndex }) => void;
  'room:start_match': () => void;
  'game:play_tile': (payload: { tileId: string; side: 'left' | 'right' }) => void;
  'game:pass': () => void;
  'game:next_hand': () => void;
  'game:rematch': () => void;
  'game:return_to_lobby': () => void;
}

export interface ServerToClientEvents {
  'state:update': (state: ClientGameState) => void;
  'toast': (payload: { type: 'info' | 'success' | 'error'; message: string }) => void;
}
