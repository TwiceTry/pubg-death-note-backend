// src/pubg/pubg-season.service.ts
import { Injectable } from '@nestjs/common';
import { PubgApiService } from './pubg-api.service';
import { PrismaService } from '../prisma/prisma.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { PubgSeason } from './pubg.interfaces';
import { SEASON_CACHE_EXPIRY_MS } from './pubg.constants';

@Injectable()
export class PubgSeasonService {
  private readonly CACHE_EXPIRY_MS = SEASON_CACHE_EXPIRY_MS;

  constructor(
    private pubgApi: PubgApiService,
    private prisma: PrismaService,
    private logger: DualOutputLoggerService,
  ) {}

  // ============================================================
  // 公开 API - 赛季查询
  // ============================================================

  /**
   * 获取所有赛季列表
   * 
   * 功能说明：
   * - 优先从数据库缓存读取（30天内有效）
   * - 缓存过期或强制刷新时从 PUBG API 获取
   * - 获取后保存到数据库缓存
   * 
   * @param forceRefresh - 是否强制刷新（跳过缓存）
   * @returns 赛季列表
   */
  async getAllSeasons(forceRefresh = false): Promise<PubgSeason[]> {
    try {
      if (!forceRefresh) {
        const cachedSeasons = await this.getCachedSeasons();
        if (cachedSeasons.length > 0) {
          this.logger.log('Season data is fresh, using cached data from database');
          return cachedSeasons;
        }
      }

      this.logger.log('Fetching seasons from API...');
      const seasons = await this.pubgApi.getAllSeasons();
      
      await this.saveSeasonsToDatabase(seasons);
      
      this.logger.log(`Found ${seasons.length} seasons`);
      return seasons;
    } catch (error) {
      this.logger.error(`Error getting all seasons:`, error);
      throw error;
    }
  }

  /**
   * 获取当前赛季
   * 
   * 功能说明：
   * - 调用 getAllSeasons 获取赛季列表
   * - 返回 isCurrent 为 true 的赛季
   * 
   * @returns 当前赛季信息，未找到时返回 null
   */
  async getCurrentSeason(): Promise<PubgSeason | null> {
    const seasons = await this.getAllSeasons();
    return seasons.find(s => s.isCurrent) || null;
  }

  // ============================================================
  // 私有方法 - 缓存管理
  // ============================================================

  /**
   * 从数据库获取缓存的赛季数据
   * 
   * 功能说明：
   * - 查询 30 天内获取过的赛季数据
   * - 按获取时间倒序排列
   * 
   * @returns 缓存的赛季列表，无缓存时返回空数组
   */
  private async getCachedSeasons(): Promise<PubgSeason[]> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - this.CACHE_EXPIRY_MS);
      const seasons = await this.prisma.season.findMany({
        where: {
          lastFetchedAt: {
            gte: thirtyDaysAgo,
          },
        },
        orderBy: {
          lastFetchedAt: 'desc',
        },
      });

      if (seasons.length > 0) {
        return seasons.map(s => ({
          id: String(s.id),
          isCurrent: s.isCurrent,
          startDate: s.startDate || undefined,
          endDate: s.endDate || undefined,
        }));
      }
      return [];
    } catch (error) {
      this.logger.error(`Error getting cached seasons:`, error);
      return [];
    }
  }

  /**
   * 保存赛季数据到数据库
   * 
   * 功能说明：
   * - 使用事务保证数据一致性
   * - 先删除旧数据，再插入新数据
   * - 记录当前时间作为 lastFetchedAt
   * 
   * @param seasons - 待保存的赛季列表
   */
  private async saveSeasonsToDatabase(seasons: PubgSeason[]): Promise<void> {
    try {
      const now = new Date();
      
      await this.prisma.$transaction(async (tx) => {
        await tx.season.deleteMany();
        
        for (const season of seasons) {
          await tx.season.create({
            data: {
              id: season.id,
              isCurrent: season.isCurrent,
              startDate: season.startDate,
              endDate: season.endDate,
              lastFetchedAt: now,
            },
          });
        }
      });
      
      this.logger.log(`Saved ${seasons.length} seasons to database`);
    } catch (error) {
      this.logger.error(`Error saving seasons to database:`, error);
      throw error;
    }
  }
}
