// src/config/env.validation.ts
import * as Joi from 'joi';

export const envSchema = Joi.object({
  // 基础环境
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  TZ: Joi.string().default('Asia/Shanghai').description('时区设置'),

  // PUBG 官方 API 配置
  PUBG_API_KEY_1: Joi.string().description('PUBG 开发者平台 API Key 1 (多个)'),
  PUBG_API_KEY_2: Joi.string().description('PUBG 开发者平台 API Key 2 (多个)'),
  PUBG_API_KEY_3: Joi.string().description('PUBG 开发者平台 API Key 3 (多个)'),
  PUBG_API_REGION: Joi.string().default('steam').description('PUBG API 区域 (steam, kakao, etc.)'),
  PUBG_API_TIMEOUT: Joi.number().default(30000).description('PUBG API 请求超时时间 (ms)'),
  PUBG_API_RETRY_COUNT: Joi.number().default(3).description('PUBG API 请求失败重试次数'),

  // 数据库 (虽然是 SQLite 文件，但 Prisma 也需要 URL 格式)
  DATABASE_URL: Joi.string().required(),
  DATABASE_MAX_CONNECTIONS: Joi.number().default(10).description('数据库最大连接数'),

  // 工作队列配置
  QUEUE_CONCURRENCY: Joi.number().default(5).description('并发处理对局数据的任务数量'),

  // 日志配置
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info')
    .description('日志级别'),
  LOG_DIR: Joi.string().default('./logs').description('日志文件存储目录'),

  // 速率限制配置
  RATE_LIMIT_TTL: Joi.number().default(60).description('速率限制时间窗口 (秒)'),
  RATE_LIMIT_MAX: Joi.number().default(100).description('每个 IP 在时间窗口内的最大请求数'),

  // 缓存配置
  CACHE_TTL: Joi.number().default(3600).description('缓存过期时间 (秒)'),

  // 安全配置
  CORS_ORIGINS: Joi.string().default('*').description('CORS 允许的来源'),
  
  // 对局数据配置
  GAME_DATA_DIR: Joi.string().default('./game-data').description('对局数据存储目录（包含对局详情和遥测数据）')
});