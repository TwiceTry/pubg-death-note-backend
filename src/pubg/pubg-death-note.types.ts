// src/pubg/pubg-death-note.types.ts

export interface DeathNoteGenerationResult {
  userId: string;
  isGenerated: boolean;
  estimatedEndTime?: Date | null;
}

export interface DeathNoteStatusResult {
  isGenerated: boolean;
  estimatedEndTime: Date | null;
  actualEndTime: Date | null;
  firstGenerationDuration: number | null;
}

export interface DeathNoteDataResult {
  userId: string;
  nickname: string;
  totalKills: number;
  totalDeaths: number;
  killEvents: any[];
  lastUpdated: Date | null;
}

export interface FailedMatch {
  matchId: string;
  error: string;
  retryCount: number;
}
