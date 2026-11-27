import type { SeatIndex, TeamId } from '../../shared/types';

export function getSeatTeam(seat: SeatIndex): TeamId {
  return seat === 0 || seat === 2 ? 'A' : 'B';
}

export function getTeamPerspective(mySeat: SeatIndex | null): {
  myTeam: TeamId;
  theirTeam: TeamId;
} {
  const myTeam: TeamId =
    mySeat !== null && (mySeat === 1 || mySeat === 3) ? 'B' : 'A';
  const theirTeam: TeamId = myTeam === 'A' ? 'B' : 'A';
  return { myTeam, theirTeam };
}

export function getTeamLabel(team: TeamId, myTeam: TeamId): 'Nosotros' | 'Ellos' {
  return team === myTeam ? 'Nosotros' : 'Ellos';
}

export function isSameTeam(seat: SeatIndex, myTeam: TeamId): boolean {
  return getSeatTeam(seat) === myTeam;
}
