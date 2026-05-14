// src/death-note/death-note.types.ts

export interface UserInfo {
  id: string;
  name: string;
}

export interface DeathNoteStatusResponse {
  isGenerated: boolean;
  status: 'not_requested' | 'generating' | 'completed' | 'error' | string;
  message?: string;
  taskId: string | null;
  progress?: number;
  createdAt?: Date;
  startedAt?: Date | null;
  userId?: string;
  nickname?: string;
  error?: string;
}

export interface DeathNoteGenerationRequestResponse {
  taskId: string;
  userId: string;
  nickname: string;
  isIncremental?: boolean;
  message: string;
}

export interface KillEventResponse {
  matchTime: Date | null;
  mapName: string | null;
  gameMode: string | null;
  victimName: string | null;
}

export interface DeathNoteDataResponse {
  userId?: string;
  nickname?: string;
  totalKills?: number;
  totalDeaths?: number;
  killEvents?: KillEventResponse[];
  lastUpdated?: Date | null;
  isGenerated?: boolean;
  status?: string;
  userInfo?: UserInfo;
  error?: string;
  message?: string;
  progress?: number;
  taskId?: string | null;
}

export interface VictimKillDetail {
  matchId: string;
  matchTime: Date | null;
  mapName: string | null;
  gameMode: string | null;
  weaponId: string;
  distance: number;
  isHeadshot: boolean;
  timestamp: Date;
  killerId: string | null;
  killerName: string | null;
  victimId: string;
  victimName: string;
}

export interface VictimKillHistoryResponse {
  userId: string;
  nickname: string;
  targetId: string;
  targetNickname: string;
  killDetails: VictimKillDetail[];
}

export interface SeasonRefreshResponse {
  success: boolean;
  message?: string;
  seasons?: Array<{
    id: string;
    isCurrent: boolean;
    startDate?: string;
    endDate?: string;
  }>;
  error?: string;
}

export interface MatchKillDetail {
  matchId: string;
  matchTime: Date | null;
  mapName: string | null;
  gameMode: string | null;
  weaponId: string;
  victimName: string;
  victimId: string;
  killerName: string;
  killerId: string | null;
  distance: number;
  isHeadshot: boolean;
  timestamp: Date;
}

export interface MatchGroup {
  matchId: string;
  matchTime: Date | null;
  mapName: string | null;
  gameMode: string | null;
  ranking: number | null;
  won: boolean;
  kills: number;
  deaths: number;
  killDetails: MatchKillDetail[];
  deathDetails: MatchKillDetail[];
}

export interface DayMatchGroup {
  date: string;
  matches: MatchGroup[];
  kills: number;
  deaths: number;
}

export interface DeathNotePaginatedResponse {
  userId: string;
  nickname: string;
  totalDays: number;
  startDate: string | null;
  endDate: string | null;
  page: number;
  pageSize: number;
  totalPages: number;
  days: DayMatchGroup[];
}

export interface SniperPlayer {
  killerName: string;
  killerId: string | null;
  killsByThem: number;
  killsByMe: number;
  totalInteractions: number;
}

export interface SniperQueryResponse {
  userId: string;
  nickname: string;
  totalSnipers: number;
  snipers: SniperPlayer[];
}
