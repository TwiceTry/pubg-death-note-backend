// src/pubg/pubg-death-note.types.ts

// ============================================================
// 击杀事件相关类型
// ============================================================

/** 击杀事件关联的比赛信息 */
export interface KillEventMatchInfo {
  playedAt: Date;
  mapName: string | null;
  gameMode: string | null;
}

/** 击杀事件详细信息 */
export interface KillEventInfo {
  id: number;
  matchId: string;
  killerId: string | null;
  killerName: string | null;
  victimId: string;
  victimName: string;
  weaponId: string;
  distance: number;
  isHeadshot: boolean;
  timestamp: Date;
  match: KillEventMatchInfo;
}

/** 击杀详情信息 */
export interface KillDetailInfo {
  matchId: string;
  matchTime: Date | null;
  mapName: string | null;
  gameMode: string | null;
  weaponId: string;
  distance: number;
  isHeadshot: boolean;
  timestamp: Date;
}

/** 狙击手玩家信息 */
export interface SniperPlayerInfo {
  killerName: string;
  killerId: string | null;
  killsByThem: number;
  killsByMe: number;
  totalInteractions: number;
}

// ============================================================
// 比赛分组相关类型
// ============================================================

/** 比赛分组信息 */
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

/** 比赛击杀详情 */
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

/** 按比赛分组的死亡笔记数据结果 */
export interface DeathNoteDataGroupedResult {
  userId: string;
  nickname: string;
  totalKills: number;
  totalDeaths: number;
  matches: MatchGroup[];
  lastUpdated: Date;
}

// ============================================================
// 死亡笔记核心类型
// ============================================================

/** 死亡笔记生成结果 */
export interface DeathNoteGenerationResult {
  userId: string;
  nickname?: string;
  isGenerated: boolean;
  estimatedDuration?: number;
  totalMatches?: number;
  processedMatches?: number;
}

/** 死亡笔记状态结果 */
export interface DeathNoteStatusResult {
  isGenerated: boolean;
  createdAt: Date | null;
  latestTaskStatus: string | null;
  latestTaskProgress: number;
  latestTaskType: string | null;
}

/** 死亡笔记概览信息 */
export interface DeathNoteOverview {
  userId: string;
  nickname: string;
  isGenerated: boolean;
  createdAt: Date;
  dailyIncrementalEnabled: boolean;
  latestTaskStatus: string | null;
  latestTaskProgress: number;
  latestTaskType: string | null;
  firstRequestTime: Date;
  lastUpdateTime: Date | null;
}

/** 死亡笔记数据结果 */
export interface DeathNoteDataResult {
  userId: string;
  nickname: string;
  totalKills: number;
  totalDeaths: number;
  killEvents: KillEventInfo[];
  lastUpdated: Date;
}

// ============================================================
// 击杀历史相关类型
// ============================================================

/** 击杀历史结果 */
export interface KillHistoryResult {
  killerId: string;
  killerNickname: string;
  victimId: string;
  victimNickname: string;
  totalKills: number;
  totalDeaths: number;
  killDetails: KillDetailInfo[];
}

/** 狙击手统计结果 */
export interface SniperStatsResult {
  totalSnipers: number;
  snipers: SniperPlayerInfo[];
}

// ============================================================
// 进度跟踪相关类型
// ============================================================

/** 失败比赛信息 */
export interface FailedMatch {
  matchId: string;
  error: string;
  retryCount: number;
}

/** 死亡笔记进度数据 */
export interface DeathNoteProgressData {
  userId: string;
  taskId: string;
  totalMatches: number;
  processedCount: number;
  processedMatches: string[];
  failedMatches: FailedMatch[];
  updatedAt: Date;
}

// ============================================================
// 用户比赛相关类型
// ============================================================

/** 用户比赛信息 */
export interface UserMatchInfo {
  matchId: string;
  ranking: number | null;
  won: boolean;
}
