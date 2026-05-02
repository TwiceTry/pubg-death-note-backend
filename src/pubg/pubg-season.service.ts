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

  async getAllSeasons(forceRefresh: boolean = false): Promise<PubgSeason[]> {
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

  async getCurrentSeason(): Promise<PubgSeason | null> {
    const seasons = await this.getAllSeasons();
    return seasons.find(s => s.isCurrent) || null;
  }

}
