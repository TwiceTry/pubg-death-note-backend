// src/pubg/pubg-api.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { PrismaService } from '../prisma/prisma.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import {
  PubgMatchResponse,
  PubgAssetResource,
  PubgMatchAttributes,
  TelemetryEvent,
  PubgMatchData,
  PubgPlayerInfo,
  PubgSeason,
} from './pubg.interfaces';
import { PUBG_API_MAX_BATCH_SIZE, PUBG_API_MIN_REQUEST_INTERVAL, PUBG_API_DEFAULT_TIMEOUT, PUBG_API_DEFAULT_RETRY_COUNT } from './pubg.constants';

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
  ) {
    this.initializeApiTokens();
  }

  async onModuleInit() {
    await this.initializeLastRequestTime();
  }

  private initializeApiTokens() {
    const tokens: string[] = [];
    
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
    
    if (tokens.length === 0) {
      const apiKeys = this.configService.get<string>('PUBG_API_KEYS');
      if (apiKeys) {
        const parsedTokens = apiKeys.split(',').map(token => token.trim()).filter(token => token.length > 0);
        tokens.push(...parsedTokens);
      }
    }
    
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

  private getNextApiToken(): ApiTokenConfig {
    const token = this.apiTokens[this.currentTokenIndex];
    this.currentTokenIndex = (this.currentTokenIndex + 1) % this.apiTokens.length;
    token.lastUsed = Date.now();
    return token;
  }

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

  private async makeApiRequest<T>(url: string, config: any, retryCount: number): Promise<any> {
    const tokenConfig = this.getNextApiToken();
    
    return tokenConfig.limiter.schedule(async () => {
      let attempts = 0;
      while (attempts < retryCount) {
        try {
          if (!config.headers) {
            config.headers = {};
          }
          config.headers.Authorization = `Bearer ${tokenConfig.token}`;
          
          const response = await axios.get<T>(url, config);
          return response;
        } catch (error) {
          attempts++;
          if (attempts >= retryCount) {
            throw error;
          }
          this.logger.warn(`API request failed, retrying (${attempts}/${retryCount})...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        } finally {
          await this.updateLastRequestTime();
        }
      }
      throw new Error('Max retries exceeded');
    });
  }

  private async makeDirectRequest<T>(url: string, config: any, retryCount: number): Promise<any> {
    let attempts = 0;
    while (attempts < retryCount) {
      try {
        return await axios.get<T>(url, config);
      } catch (error) {
        attempts++;
        if (attempts >= retryCount) {
          throw error;
        }
        this.logger.warn(`Direct request failed, retrying (${attempts}/${retryCount})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
    throw new Error('Max retries exceeded');
  }

  async getMatch(matchId: string): Promise<{ data: any; included: any[] }> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const matchUrl = `https://api.pubg.com/shards/${region}/matches/${matchId}`;

    const response = await this.makeDirectRequest<PubgMatchResponse>(matchUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount);

    return {
      data: response.data.data,
      included: response.data.included,
    };
  }

  async getMatchTelemetry(telemetryUrl: string): Promise<TelemetryEvent[]> {
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const response = await this.makeDirectRequest<TelemetryEvent[]>(telemetryUrl, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
      timeout,
    }, retryCount);

    return response.data;
  }

  /**
   * 通过昵称查询用户（支持单个或多个，最多10个）
   * @param nicknames 用户昵称（单个字符串或字符串数组）
   * @returns 用户信息列表
   */
  async getPlayersByNicknames(nicknames: string | string[]): Promise<PubgPlayerInfo[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userSearchUrl = `https://api.pubg.com/shards/${region}/players`;

    // 统一处理单个和多个昵称
    const nicknameList = Array.isArray(nicknames) ? nicknames : [nicknames];
    
    // PUBG API 限制每次最多查询10个用户，分批处理
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
      }, retryCount);

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
   * 通过昵称查询单个用户（兼容旧接口）
   * @param nickname 用户昵称
   * @returns 用户信息
   */
  async getPlayerByNickname(nickname: string): Promise<PubgPlayerInfo> {
    const players = await this.getPlayersByNicknames(nickname);
    
    if (players.length === 0) {
      throw new Error(`User with nickname "${nickname}" not found`);
    }

    return players[0];
  }

  /**
   * 通过用户ID查询单个用户
   * 注意：此接口返回单个对象，不是数组
   * @param playerId 用户ID
   * @returns 用户信息
   */
  async getPlayerById(playerId: string): Promise<PubgPlayerInfo> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userUrl = `https://api.pubg.com/shards/${region}/players/${playerId}`;

    const response = await this.makeApiRequest<any>(userUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount);

    // 单个用户查询返回的是单个对象，不是数组
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
   * 通过用户ID批量查询用户信息（支持单个或多个，最多10个）
   * @param playerIds 用户ID列表（支持单个或多个）
   * @returns 用户信息列表
   */
  async getPlayersByIds(playerIds: string | string[]): Promise<PubgPlayerInfo[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const userSearchUrl = `https://api.pubg.com/shards/${region}/players`;

    // 统一处理单个和多个ID
    const playerIdList = Array.isArray(playerIds) ? playerIds : [playerIds];
    
    // PUBG API 限制每次最多查询10个用户，分批处理
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
      }, retryCount);

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

  async getAllSeasons(): Promise<PubgSeason[]> {
    const region = this.configService.get<string>('PUBG_API_REGION', 'steam');
    const timeout = this.configService.get<number>('PUBG_API_TIMEOUT', 30000);
    const retryCount = this.configService.get<number>('PUBG_API_RETRY_COUNT', 3);

    const seasonsUrl = `https://api.pubg.com/shards/${region}/seasons`;

    const response = await this.makeApiRequest<any>(seasonsUrl, {
      headers: { Accept: 'application/vnd.api+json' },
      timeout,
    }, retryCount);

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
