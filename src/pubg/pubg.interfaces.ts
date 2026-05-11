// src/pubg/pubg.interfaces.ts

// ==========================================
// 1. 基础类型定义
// ==========================================

// 游戏模式类型
export type GameMode = 'solo' | 'solo-fpp' | 'duo' | 'duo-fpp' | 'squad' | 'squad-fpp';

// 地图名称类型
export type MapName = 'Erangel' | 'Miramar' | 'Sanhok' | 'Vikendi' | 'Karakin' | 'Haven' | 'Paramo' | 'Deston';

// 比赛类型
export type MatchType = 'ranked' | 'unranked';

// 平台类型
export type Platform = 'pc' | 'xbox' | 'psn';

// 平台分片类型
export type PlatformShard = 'kakao' | 'stadia' | 'steam' | 'tournament' | 'psn' | 'xbox' | 'console';

// 平台-区域分片类型
export type PlatformRegionShard = 
  | 'pc-as' | 'pc-eu' | 'pc-jp' | 'pc-kakao' | 'pc-krjp' | 'pc-na' | 'pc-oc' | 'pc-ru' | 'pc-sa' | 'pc-sea' | 'pc-tournament'
  | 'psn-as' | 'psn-eu' | 'psn-na' | 'psn-oc'
  | 'xbox-as' | 'xbox-eu' | 'xbox-na' | 'xbox-oc' | 'xbox-sa';

// 服务器分片 ID
export type ShardId = PlatformShard | PlatformRegionShard;

// 赛季状态
export type SeasonState = 'preseason' | 'inprogress' | 'completed';

// 伤害类型分类
export type DamageTypeCategory = 'Damage_Gun' | 'Damage_Explosion' | 'Damage_Melee' | 'Damage_BlueZone' | 'Damage_RedZone' | 'Damage_Fall' | 'Damage_Vehicle' | 'Damage_Drown' | 'Damage_Environment';

// 伤害原因
export type DamageReason = 'HeadShot' | 'TorsoShot' | 'ArmShot' | 'LegShot' | 'Unknown';

// ==========================================
// 2. PUBG API HTTP 响应结构 (JSON:API 标准)
// ==========================================

export interface PubgMatchAttributes {
  createdAt: string;
  duration: number;
  gameMode: GameMode;
  mapName: MapName;
  matchType: MatchType;
  shardId: ShardId;
  titleId: string;
  seasonState: SeasonState;
}

export interface PubgAssetAttributes {
  URL: string;
  createdAt: string;
  name: string;
}

// 通用的 JSON:API Data 对象
export interface PubgResource<T = any> {
  type: string;
  id: string;
  attributes: T;
}

// 具体的 Match 资源
export type PubgMatchResource = PubgResource<PubgMatchAttributes>;

// 具体的 Asset 资源 (Telemetry 下载链接在这里)
export type PubgAssetResource = PubgResource<PubgAssetAttributes>;

// PUBG API 返回的完整结构
export interface PubgMatchResponse {
  data: PubgMatchResource;
  included: Array<PubgAssetResource | any>; // included 里可能混杂着 participant, roster 等，这里主要关心 Asset
  links: {
    self: string;
  };
  meta: any;
}

// ==========================================
// 3. Telemetry 日志结构 (大文件内容)
// ==========================================

// 基础事件结构
export interface TelemetryBaseEvent {
  _T: string; // Event Type, e.g., 'LogPlayerKill'
  _D: string; // Event Timestamp (ISO string)
  common: {
    isGame: number;
  };
}

// 玩家/角色信息对象
export interface PubgCharacter {
  name: string;
  teamId: number;
  health: number;
  location: {
    x: number;
    y: number;
    z: number;
  };
  ranking: number;
  accountId: string;
  isInBlueZone: boolean;
  isInRedZone: boolean;
  zoneId: string[];
}

// 核心：击杀事件结构
export interface LogPlayerKill extends TelemetryBaseEvent {
  _T: 'LogPlayerKill';
  attackId: number;

  // killer 可能为 null (例如：摔死、被载具压死、被毒死)
  killer: PubgCharacter | null;
  victim: PubgCharacter;

  damageTypeCategory: DamageTypeCategory; // 伤害类型分类
  damageCauserName?: string; // 造成伤害的武器名称
  damageReason?: DamageReason; // 伤害原因
  distance: number;

  // 还有很多字段，暂时只定义我们用到的
  isSuicide: boolean;
}

// Telemetry 数组可能包含多种事件
export type TelemetryEvent = LogPlayerKill | TelemetryBaseEvent;

// ==========================================
// 4. 服务层数据结构
// ==========================================

/**
 * 比赛数据结果
 */
export interface MatchDataResult {
  attributes: PubgMatchAttributes;
  included?: any[];
  telemetryEvents: TelemetryEvent[];
  dataPath: string;
}

/**
 * 用户信息
 */
export interface PubgPlayerInfo {
  id: string;
  name: string;
  matches?: string[];
  clanId?: string;
  shardId?: string;
}

/**
 * 赛季信息
 */
export interface PubgSeason {
  id: string;
  isCurrent: boolean;
  startDate?: string;
  endDate?: string;
}

/**
 * 比赛数据（包含遥测事件）
 */
export interface PubgMatchData {
  attributes: PubgMatchAttributes;
  telemetryEvents: TelemetryEvent[];
}

/**
 * 击杀事件解析结果
 */
export interface ParsedKillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weaponId: string;
  distance: number;
  isHeadshot: boolean;
  timestamp: Date;
}

/**
 * 比赛参与者信息
 */
export interface MatchParticipant {
  accountId: string;
  name: string;
  teamId: number;
  ranking: number;
}

/**
 * 遥测事件原始数据（LogPlayerKillV2 格式）
 */
export interface TelemetryKillEventV2 {
  _T: 'LogPlayerKillV2' | 'LogPlayerKill';
  _D: string;
  killer?: {
    accountId: string;
    name: string;
  } | null;
  victim?: {
    accountId: string;
    name: string;
  } | null;
  character?: {
    accountId: string;
    name: string;
  } | null;
  finishDamageInfo?: {
    damageCauserName: string;
    distance: number;
    damageReason: string;
    damageTypeCategory?: string;
  };
  killerDamageInfo?: {
    damageCauserName: string;
    distance: number;
    damageReason: string;
    damageTypeCategory?: string;
  };
  weapon?: {
    weaponId: string;
    weaponClass: string;
  };
  distance?: number;
  isHeadshot?: boolean;
  timestamp?: string;
}

/**
 * 比赛原始数据（包含参与者）
 */
export interface RawMatchData {
  data: {
    id: string;
    type: string;
    attributes: PubgMatchAttributes;
    relationships?: {
      participants?: {
        data: Array<{ type: string; id: string }>;
      };
      assets?: {
        data: Array<{ type: string; id: string }>;
      };
    };
  };
  included: Array<{
    type: string;
    id: string;
    attributes: Record<string, unknown>;
  }>;
  links?: {
    self: string;
  };
}

/**
 * 游戏数据翻译表
 */
export interface GameDataI18n {
  maps: Record<string, string>;
  gameModes: Record<string, string>;
  weapons: Record<string, string>;
}
