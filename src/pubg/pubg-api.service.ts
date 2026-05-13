// src/pubg/pubg-api.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { PrismaService } from '../prisma/prisma.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { ApiStatsService } from './api-stats.service';
import { ApiRequestDetailService } from './api-request-detail.service';
import {
  PubgMatchResponse,
  TelemetryEvent,
  PubgPlayerInfo,
  PubgSeason,
} from './pubg.interfaces';
import { PUBG_API_MAX_BATCH_SIZE, PUBG_API_MIN_REQUEST_INTERVAL } from './pubg.constants';

interface ApiTokenConfig {
  token: string;
  limiter: Bottleneck;
  lastUsed: number;
}

@Injectable()
export class PubgApiService implements OnModuleInit {
  private apiTokens: ApiTokenConfig[] = [];
  private currentTokenIndex = 0;
  
  private readonly MAX_BATCH_SIZE = PUBG_API_MAX_BATCH_SIZE;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private logger: DualOutputLoggerService,
    private apiStatsService: ApiStatsService,
    private apiRequestDetailService: ApiRequestDetailService,
  ) {
    this.initializeApiTokens();
  }

  async onModuleInit() {
    await this.initializeLastRequestTime();
  }

  // ============================================================
  // 私有方法 - Token 管理
  // ============================================================

  /**
   * 初始化 API Token 列表
   * 
   * 功能说明：
   * - 按优先级读取配置：PUBG_API_KEY_N > PUBG_API_KEYS > PUBG_API_KEY
   * - 为每个 Token 创建独立的限流器
   * - 使用轮询方式分配请求
   */
  private initializeApiTokens() {
    const tokens: string[] = [];
    
    // 方式 1：读取 PUBG_API_KEY_1, PUBG_API_KEY_2, ...
    let index = 1;
    while (true) {
      const key = `PUBG_API_KEY_${index}`;
      const token = this.configService.get<string>(key);
      if (token && token.trim().length > 0) {
        tokens.push(token.trim());
        index++;
      } else {
        break;
      }
    }
    
    // 方式 2：读取 PUBG_API_KEYS（逗号分隔）
    if (tokens.length === 0) {
      const apiKeys = this.configService.get<string>('PUBG_API_KEYS');
      if (apiKeys) {
        const parsedTokens = apiKeys.split(',').map(token => token.trim()).filter(token => token.length > 0);
        tokens.push(...parsedTokens);
      }
    }
    
    // 方式 3：读取单个 PUBG_API_KEY
    if (tokens.length === 0) {
      const singleKey = this.configService.get<string>('PUBG_API_KEY');
      if (singleKey && singleKey.trim().length > 0) {
        tokens.push(singleKey.trim());
      }
    }
    
    if (tokens.length === 0) {
      this.logger.error('No PUBG API keys configured');
      throw new Error('No PUBG API keys configured');
    }
    
    this.logger.log(`Initializing ${tokens.length} API tokens`);
    
    this.apiTokens = tokens.map(token => ({
      token,
      limiter: new Bottleneck({
        maxConcurrent: 1,
        minTime: PUBG_API_MIN_REQUEST_INTERVAL,
      }),
      lastUsed: 0,
    }));
  }

  /**
   * 获取下一个 API Token（轮询方式）
   * 
   * @returns Token 配置对象
   */
  private getNextApiToken(): ApiTokenConfig {
    const token = this.apiTokens[this.currentTokenIndex];
    this.currentTokenIndex = (this.currentTokenIndex + 1) % this.apiTokens.length;
    token.lastUsed = Date.now();
    return token;
  }

  // ============================================================
  // 私有方法 - 请求时间管理
  // ============================================================

  /**
   * 初始化最后请求时间
   * 
   * 功能说明：
   * - 从数据库读取上次请求时间
   * - 计算需要等待的时间以满足限流要求
   * - 等待必要的时间后再进行首次请求
   */
  private async initializeLastRequestTime() {
    try {
      this.logger.log('Initializing last request time...');
      const apiRequestLog = await this.prisma.apiRequestLog.findFirst({
        where: { requestType: 'rate_limited' },
      });
      
      if (apiRequestLog) {
        this.logger.log(`Found existing API request log: ${apiRequestLog.lastRequest}`);
        const lastRequestTime = apiRequestLog.lastRequest.getTime();
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        const requiredWaitTime = 6000 - timeSinceLastRequest;
        
        if (requiredWaitTime > 0) {
          this.logger.log(`Waiting ${requiredWaitTime}ms before first API request`);
          await new Promise(resolve => setTimeout(resolve, requiredWaitTime));
        } else {
          this.logger.log(`No wait needed, time since last request: ${timeSinceLastRequest}ms`);
        }
      }
    } catch (error) {
      this.logger.error(`Error initializing last request time:`, error);
    }
  }

  /**
   * 更新最后请求时间到数据库
   */
  private async updateLastRequestTime() {
    try {
      await this.prisma.apiRequestLog.upsert({
        where: { requestType: 'rate_limited' },
        update: { lastRequest: new Date() },
        create: { requestType: 'rate_limited', lastRequest: new Date() },
      });
    } catch (error) {
      this.logger.error(`Error updating last request time:`, error);
    }
  }

  // ============================================================
  // 私有方法 - HTTP 请求
  // ============================================================

  /**
   * 执行带限流的 API 请求
   * 
   * 功能说明：
   * - 使用 Bottleneck 限流器控制请求频率
   * - 支持自动重试
   * - 记录请求详情和统计信息
   * 
   * @param url - 请求 URL
   * @param config - Axios 配置
   * @param retryCount - 重试次数
   * @param endpoint - 端点类型
   * @returns Axios 响应
   */
  private async makeApiRequest<T>(url: string, config: any, retryCount: number, endpoint: string): Promise<any> {
    const tokenConfig = this.getNextApiToken();
    const maskedToken = tokenConfig.token.substring(0, 8) + '...';
    
    return tokenConfig.limiter.schedule(async () => {
      let attempts = 0;
      const startTime = Date.now();
      let rateLimited = false;
      
      while (attempts < retryCount) {
        try {
          if (!config.headers) {
            config.headers = {};
          }
          config.headers.Authorization = `Bearer ${tokenConfig.token}`;
          
          const response = await axios.get<T>(url, config);
          const responseTime = Date.now() - startTime;
          
          let responseData: string | undefined;
          if (endpoint === 'match') {
            responseData = JSON.stringify({ matchId: (response.data as any)?.data?.id });
          } else if (endpoint === 'telemetry') {
            responseData = JSON.stringify({ telemetrySize: (response.data as any)?.length || 0 });
          } else {
            responseData = JSON.stringify(response.data).substring(0, 1000);
          }
          
          await Promise.all([
            this.apiStatsService.recordRequest(endpoint, responseTime, true, rateLimited),
            this.apiRequestDetailService.recordRequest(
              url, 'GET', maskedToken, responseTime, true, endpoint, undefined, responseData
            ),
          ]);
          
          return response;
        } catch (error) {
          attempts++;
          if (attempts >= retryCount) {
            const responseTime = Date.now() - startTime;
            const errorMessage = error.response ? `${error.response.status} ${error.response.statusText}` : error.message;
            
            await Promise.all([
              this.apiStatsService.recordRequest(endpoint, responseTime, false, rateLimited),
              this.apiRequestDetailService.recordRequest(
                url, 'GET', maskedToken, responseTime, false, endpoint, errorMessage
              ),
            ]);
            
            throw error;
          }
          this.logger.warn(`API request failed, retrying (${attempts}/${retryCount})...`);
          rateLimited = true;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        } finally {
          await this.updateLastRequestTime();
        }
      }
      throw new Error('Max retries exceeded');
    });
  }

  /**
   * 执行直接请求（不限流）
   * 
   * 功能说明：
   * - 不使用 Bottleneck 限流器
   * - 支持自动重试
   * - 记录请求详情
   * 
   * @param url - 请求 URL
   * @param config - Axios 配置
   * @param retryCount - 重试次数
   * @param endpoint - 端点类型
   * @returns Axios 响应
   */
  private async makeDirectRequest<T>(url: string, config: any, retryCount: number, endpoint: string): Promise<any> {
    let attempts = 0;
    const startTime = Date.now();
    
    while (attempts < retryCount) {
      try {
        const response = await axios.get<T>(url, config);
        const responseTime = Date.now() - startTime;
        
        let responseData: string | undefined;
        if (endpoint === 'match') {
          responseData = JSON.stringify({ matchId: (response.data as any)?.data?.id });
        } else if (endpoint === 'telemetry') {
          responseData = JSON.stringify({ telemetrySize: (response.data as any)?.length || 0 });
        } else {
          responseData = JSON.stringify(response.data).substring(0, 1000);
        }
        
        await this.apiRequestDetailService.recordRequest(
          url, 'GET', 'direct', responseTime, true, endpoint, undefined, responseData
        );
        
        return response;
      } catch (error) {
        attempts++;
        if (attempts >= retryCount) {
          const responseTime = Date.now() - startTime;
          const errorMessage = error.response ? `${error.response.status} ${error.response.statusText}` : error.message;
          
          await this.apiRequestDetailService.recordRequest(
            url, 'GET', 'direct', responseTime, false, endpoint, errorMessage
          );
          
          throw error;
        }
        this.logger.warn(`Direct request failed, retrying (${attempts}/${retryCount})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
    throw new Error('Max retries exceeded');
  }

  // ============================================================
  // 公开 API - 比赛数据
  // ============================================================

  /**
   * 获取比赛数据
   * 
   * 功能说明：
   * - 从 PUBG API 获取指定比赛的详细信息
   * - 返回比赛数据和包含的玩家/队伍信息
   * 
   * @param matchId - 比赛 ID
   * @returns 比赛数据（data 和 included）
   */
  async getMatch(matchId: string): Promise<{ data: any; included: any[] }> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const matchUrl = `https://api.pubg.com/shards/${region}/matches/${matchId}`;

    const response = await this.makeDirectRequest<PubgMatchResponse>(matchUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount, 'match');

    return {
      data: response.data.data,
      included: response.data.included,
    };
  }

  /**
   * 获取比赛遥测数据
   * 
   * 功能说明：
   * - 从遥测 URL 获取比赛事件数据
   * - 支持大文件下载（无内容长度限制）
   * 
   * @param telemetryUrl - 遥测数据 URL
   * @returns 遥测事件列表
   */
  async getMatchTelemetry(telemetryUrl: string): Promise<TelemetryEvent[]> {
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const response = await this.makeDirectRequest<TelemetryEvent[]>(telemetryUrl, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
      timeout,
    }, retryCount, 'telemetry');

    return response.data;
  }

  // ============================================================
  // 公开 API - 玩家查询
  // ============================================================

  /**
   * 通过昵称查询玩家（支持批量查询，最多 10 个）
   * 
   * 功能说明：
   * - 支持单个昵称或昵称数组
   * - 自动分批处理（每批最多 10 个）
   * - 返回所有匹配的玩家信息
   * 
   * @param nicknames - 用户昵称（单个字符串或字符串数组）
   * @returns 玩家信息列表
   */
  async getPlayersByNicknames(nicknames: string | string[]): Promise<PubgPlayerInfo[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userSearchUrl = `https://api.pubg.com/shards/${region}/players`;

    const nicknameList = Array.isArray(nicknames) ? nicknames : [nicknames];
    
    const batches: string[][] = [];
    for (let i = 0; i < nicknameList.length; i += this.MAX_BATCH_SIZE) {
      batches.push(nicknameList.slice(i, i + this.MAX_BATCH_SIZE));
    }

    const allResults: PubgPlayerInfo[] = [];
    
    for (const batch of batches) {
      const response = await this.makeApiRequest<any>(userSearchUrl, {
        headers: { Accept: 'application/vnd.api+json' },
        params: { 'filter[playerNames]': batch.join(',') },
        timeout,
      }, retryCount, 'player');

      if (response.data.data && response.data.data.length > 0) {
        const players = response.data.data.map((user: any) => ({
          id: user.id,
          name: user.attributes.name,
          clanId: user.attributes.clanId,
          shardId: user.attributes.shardId,
          matches: user.relationships?.matches?.data?.map((m: any) => m.id) || [],
        }));
        allResults.push(...players);
      }
    }

    return allResults;
  }

  /**
   * 通过昵称查询单个玩家（兼容旧接口）
   * 
   * @param nickname - 用户昵称
   * @returns 玩家信息
   */
  async getPlayerByNickname(nickname: string): Promise<PubgPlayerInfo> {
    const players = await this.getPlayersByNicknames(nickname);
    
    if (players.length === 0) {
      throw new Error(`User with nickname "${nickname}" not found`);
    }

    return players[0];
  }

  /**
   * 通过玩家 ID 查询单个玩家
   * 
   * 功能说明：
   * - 返回单个玩家对象，不是数组
   * 
   * @param playerId - 玩家 ID
   * @returns 玩家信息
   */
  async getPlayerById(playerId: string): Promise<PubgPlayerInfo> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userUrl = `https://api.pubg.com/shards/${region}/players/${playerId}`;

    const response = await this.makeApiRequest<any>(userUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount, 'player');

    const user = response.data.data;
    
    return {
      id: user.id,
      name: user.attributes.name,
      clanId: user.attributes.clanId,
      shardId: user.attributes.shardId,
      matches: user.relationships?.matches?.data?.map((m: any) => m.id) || [],
    };
  }

  /**
   * 通过玩家 ID 批量查询玩家信息（支持批量查询，最多 10 个）
   * 
   * 功能说明：
   * - 支持单个 ID 或 ID 数组
   * - 自动分批处理（每批最多 10 个）
   * - 返回所有匹配的玩家信息
   * 
   * @param playerIds - 玩家 ID 列表（支持单个或多个）
   * @returns 玩家信息列表
   */
  async getPlayersByIds(playerIds: string | string[]): Promise<PubgPlayerInfo[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userSearchUrl = `https://api.pubg.com/shards/${region}/players`;

    const playerIdList = Array.isArray(playerIds) ? playerIds : [playerIds];
    
    const batches: string[][] = [];
    for (let i = 0; i < playerIdList.length; i += this.MAX_BATCH_SIZE) {
      batches.push(playerIdList.slice(i, i + this.MAX_BATCH_SIZE));
    }

    const allResults: PubgPlayerInfo[] = [];
    
    for (const batch of batches) {
      const response = await this.makeApiRequest<any>(userSearchUrl, {
        headers: { Accept: 'application/vnd.api+json' },
        params: { 'filter[playerIds]': batch.join(',') },
        timeout,
      }, retryCount, 'player');

      if (response.data.data && response.data.data.length > 0) {
        const players = response.data.data.map((user: any) => ({
          id: user.id,
          name: user.attributes.name,
          clanId: user.attributes.clanId,
          shardId: user.attributes.shardId,
          matches: user.relationships?.matches?.data?.map((m: any) => m.id) || [],
        }));
        allResults.push(...players);
      }
    }

    return allResults;
  }

  // ============================================================
  // 公开 API - 赛季查询
  // ============================================================

  /**
   * 获取所有赛季列表
   * 
   * 功能说明：
   * - 从 PUBG API 获取指定区域的所有赛季
   * - 返回赛季 ID、是否当前赛季、开始/结束时间
   * 
   * @returns 赛季列表
   */
  async getAllSeasons(): Promise<PubgSeason[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const seasonsUrl = `https://api.pubg.com/shards/${region}/seasons`;

    const response = await this.makeApiRequest<any>(seasonsUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount, 'season');

    const seasons = response.data.data.map((s: any) => ({
      id: s.id,
      isCurrent: s.attributes.isCurrent || false,
      startDate: s.attributes.startDate,
      endDate: s.attributes.endDate,
    }));

    this.logger.log(`Found ${seasons.length} seasons`);
    return seasons;
  }
}
