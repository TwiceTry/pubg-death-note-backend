// src/pubg/pubg-death-note.types.ts

export interface DeathNoteGenerationResult {
  userId: string;
  nickname?: string;
  isGenerated: boolean;
  estimatedDuration?: number;
  totalMatches?: number;
  processedMatches?: number;
}

export interface DeathNoteStatusResult {
  isGenerated: boolean;
  createdAt: Date | null;
  latestTaskStatus: string | null;
  latestTaskProgress: number;
  latestTaskType: string | null;
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
