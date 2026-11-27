import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, PlusCircle, Users } from 'lucide-react';
import { DominoTile } from './DominoTile';

export interface HomeScreenProps {
  initialName: string;
  initialRoomCode: string;
  isConnected: boolean;
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
}

export function HomeScreen({
  initialName,
  initialRoomCode,
  isConnected,
  onCreateRoom,
  onJoinRoom,
}: HomeScreenProps) {
  const [name, setName] = useState(initialName);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const hasInviteCode = initialRoomCode.length === 4;

  const ensureName = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Escribe tu nombre para sentarte a la mesa');
      nameInputRef.current?.focus();
      return null;
    }
    setNameError(null);
    return trimmed;
  };

  const handleCreate = () => {
    const validName = ensureName();
    if (!validName) return;
    onCreateRoom(validName);
  };

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validName = ensureName();
    if (!validName) return;
    onJoinRoom(roomCode, validName);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col justify-between px-4 py-5 safe-top safe-bottom max-w-md mx-auto">
      {/* Header / Emblem */}
      <header className="flex flex-col items-center text-center pt-2">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="-rotate-12 drop-shadow-xl">
            <DominoTile
              tile={{ id: '6-6', a: 6, b: 6 }}
              orientation="vertical"
              size="sm"
            />
          </div>
          <div className="rotate-6 translate-y-1 drop-shadow-xl">
            <DominoTile
              tile={{ id: '3-5', a: 3, b: 5 }}
              orientation="vertical"
              size="sm"
            />
          </div>
        </div>

        <h1 className="font-display text-3xl font-extrabold tracking-tight text-stone-50">
          Club de Dominó
        </h1>
        <p className="text-xs sm:text-sm text-emerald-100/80 mt-1">
          Dominó de parejas • 4 jugadores en tiempo real
        </p>
      </header>

      {/* Main Entry Card */}
      <main className="my-4 space-y-3.5">
        {hasInviteCode && (
          <div className="rounded-xl bg-emerald-900/70 border border-emerald-400/45 px-3.5 py-2.5 text-center shadow-lg">
            <p className="text-xs font-semibold text-emerald-100">
              Invitación detectada para la mesa{' '}
              <span className="font-display font-extrabold text-amber-300 tracking-widest">
                {initialRoomCode}
              </span>
            </p>
            <p className="text-[11px] text-emerald-200/80 mt-0.5">
              Escribe tu nombre y toca &ldquo;Unirse a Mesa&rdquo;
            </p>
          </div>
        )}

        <section className="mahogany-card rounded-2xl p-4 sm:p-5 space-y-4">
          {/* Player Name */}
          <div>
            <label
              htmlFor="player-name-input"
              className="block text-xs font-bold uppercase tracking-wider text-amber-200/90 mb-1.5"
            >
              Tu nombre en la mesa
            </label>
            <input
              ref={nameInputRef}
              id="player-name-input"
              type="text"
              value={name}
              maxLength={24}
              placeholder="Ej. Don Beto, Sofía..."
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              className="w-full rounded-xl bg-black/35 border border-amber-400/30 px-3.5 py-3 text-base font-semibold text-stone-50 placeholder:text-stone-400/60 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25 transition"
            />
            {nameError && (
              <p className="text-xs text-rose-300 font-medium mt-1.5">{nameError}</p>
            )}
          </div>

          {/* If invited via URL, put Join first visually; otherwise Create first */}
          {!hasInviteCode && (
            <button
              type="button"
              onClick={handleCreate}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 font-extrabold text-base shadow-[0_6px_20px_rgba(212,175,55,0.35)] active:scale-[0.98] transition-transform cursor-pointer"
            >
              <PlusCircle className="w-5 h-5" />
              <span>Crear Mesa Nueva</span>
            </button>
          )}

          {/* Join by Code Card */}
          <form
            onSubmit={handleJoinSubmit}
            className={`rounded-xl p-3.5 border space-y-2.5 ${
              hasInviteCode
                ? 'bg-emerald-950/65 border-amber-400/60 shadow-[0_0_20px_rgba(212,175,55,0.18)]'
                : 'bg-black/25 border-amber-400/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <label
                htmlFor="room-code-input"
                className="text-xs font-bold uppercase tracking-wider text-emerald-100/90"
              >
                Unirse con código
              </label>
              <span className="text-[11px] text-amber-300/80 font-medium">
                4 caracteres
              </span>
            </div>

            <div className="flex gap-2">
              <input
                id="room-code-input"
                type="text"
                value={roomCode}
                maxLength={4}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCD"
                onChange={(e) =>
                  setRoomCode(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
                  )
                }
                className="w-28 shrink-0 rounded-xl bg-black/45 border border-amber-400/35 px-2 py-2.5 text-center font-display text-lg font-extrabold tracking-[0.25em] uppercase text-amber-200 placeholder:text-stone-500 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25"
              />

              <button
                type="submit"
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-extrabold text-sm active:scale-[0.98] transition cursor-pointer ${
                  hasInviteCode
                    ? 'bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-stone-950 shadow-lg'
                    : 'bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-400/40'
                }`}
              >
                <span>Unirse a Mesa</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>

          {hasInviteCode && (
            <button
              type="button"
              onClick={handleCreate}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-black/30 hover:bg-black/45 border border-amber-400/35 text-amber-200 font-bold text-sm active:scale-[0.98] transition cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>O crear una mesa nueva</span>
            </button>
          )}
        </section>
      </main>

      {/* Rules Summary Footer */}
      <footer className="space-y-2 pb-1">
        <div className="rounded-xl bg-black/25 border border-white/10 px-3.5 py-2.5 flex items-center justify-center gap-2 text-center">
          <Users className="w-4 h-4 text-amber-300 shrink-0" />
          <p className="text-[11px] sm:text-xs font-medium text-emerald-100/90 leading-snug">
            Parejas frente a frente • A 100 puntos • Mula de 6 abre
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-200/65">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span>{isConnected ? 'Servidor conectado' : 'Conectando al club...'}</span>
        </div>
      </footer>
    </div>
  );
}

export default HomeScreen;
