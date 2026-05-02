// src/pubg/pubg.constants.ts

// ==========================================
// API 配置常量
// ==========================================

/**
 * PUBG API 批量查询限制：每次最多查询10个用户
 */
export const PUBG_API_MAX_BATCH_SIZE = 10;

/**
 * 默认 API 请求超时时间（毫秒）
 */
export const PUBG_API_DEFAULT_TIMEOUT = 30000;

/**
 * 默认 API 重试次数
 */
export const PUBG_API_DEFAULT_RETRY_COUNT = 3;

/**
 * 单个 API Token 最小请求间隔（毫秒）
 * PUBG API 限制每分钟最多10次请求，约6000ms间隔
 * 设置为7000ms以确保安全
 */
export const PUBG_API_MIN_REQUEST_INTERVAL = 7000;

// ==========================================
// 缓存配置常量
// ==========================================

/**
 * 用户信息缓存过期时间（毫秒）- 1天
 */
export const USER_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * 赛季信息缓存过期时间（毫秒）- 30天
 */
export const SEASON_CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// ==========================================
// 任务类型常量
// ==========================================

/**
 * 任务类型枚举
 */
export enum PubgTaskType {
  REPARSE_MATCH = 'reparse_match',
  REPARSE_USER = 'reparse_user',
  REPARSE_ALL = 'reparse_all',
  DEATH_NOTE_GENERATE = 'death_note_generate',
  DEATH_NOTE_FORCE_GENERATE = 'death_note_force_generate',
}

// ==========================================
// 验证规则常量
// ==========================================

/**
 * 用户ID前缀
 */
export const USER_ID_PREFIX = 'account.';

/**
 * 比赛ID最小长度
 */
export const MATCH_ID_MIN_LENGTH = 32;

/**
 * 用户昵称最小长度
 */
export const NICKNAME_MIN_LENGTH = 4;

/**
 * 用户昵称最大长度
 */
export const NICKNAME_MAX_LENGTH = 16;
