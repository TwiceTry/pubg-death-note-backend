// src/pubg/pubg-user.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgApiService } from './pubg-api.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { USER_CACHE_EXPIRY_MS } from './pubg.constants';

@Injectable()
export class PubgUserService {
  constructor(
    private prisma: PrismaService,
    private pubgApi: PubgApiService,
    private logger: DualOutputLoggerService,
  ) {}

  /**
   * 通过用户昵称获取用户信息
   * @param nickname 用户昵称
   * @returns 用户信息，包含用户 ID 和其他详情
   */
  async getUserByNickname(nickname: string): Promise<{ id: string; name: string; }> {
    try {
      // 1. 尝试从数据库获取
      let user = await this.prisma.user.findFirst({
        where: { nickname },
      });

      if (user) {
        // 2. 检查用户信息是否需要更新（超过 1 天）
        const shouldUpdate = this.shouldUpdateUser(user.updatedAt);
        if (shouldUpdate) {
          try {
            // 3. 调用 API 获取最新信息
            const latestUserInfo = await this.pubgApi.getPlayerByNickname(nickname);
            
            // 4. 检查是否改名
            if (latestUserInfo.id !== user.pubgId) {
              // 用户 ID 不匹配，可能是昵称被其他用户使用
              // 重新查询或创建新记录
              await this.createOrUpdateUser(latestUserInfo);
              return latestUserInfo;
            }
            
            // 5. 更新用户信息
            user = await this.prisma.user.update({
              where: { pubgId: user.pubgId },
              data: {
                nickname: latestUserInfo.name,
              },
            });
          } catch (error) {
            // API 调用失败，返回数据库中的记录
            this.logger.warn(`Failed to update user info, using cached data:`, error);
          }
        }
        
        return { id: user.pubgId, name: user.nickname };
      }

      // 6. 数据库未命中，调用 API
      const userInfo = await this.pubgApi.getPlayerByNickname(nickname);
      
      // 7. 存储到数据库
      await this.createOrUpdateUser(userInfo);
      
      return userInfo;
    } catch (error) {
      this.logger.error(`Error getting user by nickname ${nickname}:`, error);
      throw error;
    }
  }

  /**
   * 通过用户 ID 获取用户信息
   * @param userId 用户 ID
   * @returns 用户信息，包含用户 ID 和昵称
   */
  async getUserById(userId: string): Promise<{ id: string; name: string; }> {
    try {
      // 1. 尝试从数据库获取
      let user = await this.prisma.user.findFirst({
        where: { pubgId: userId },
      });

      if (user) {
        // 2. 检查用户信息是否需要更新（超过 1 天）
        const shouldUpdate = this.shouldUpdateUser(user.updatedAt);
        if (shouldUpdate) {
          try {
            // 3. 调用 API 获取最新信息
            const latestUserInfo = await this.pubgApi.getPlayerById(userId);
            
            // 4. 更新用户信息
            user = await this.prisma.user.update({
              where: { pubgId: userId },
              data: {
                nickname: latestUserInfo.name,
              },
            });
          } catch (error) {
            // API 调用失败，返回数据库中的记录
            this.logger.warn(`Failed to update user info, using cached data:`, error);
          }
        }
        
        return { id: user.pubgId, name: user.nickname };
      }

      // 6. 数据库未命中，调用 API
      const userInfo = await this.pubgApi.getPlayerById(userId);
      
      // 7. 存储到数据库
      await this.createOrUpdateUser(userInfo);
      
      return userInfo;
    } catch (error) {
      this.logger.error(`Error getting user by ID ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 创建或更新用户信息
   * @param userInfo 用户信息
   * @returns 更新后的用户信息
   */
  async createOrUpdateUser(userInfo: { id: string; name: string; }) {
    return this.prisma.user.upsert({
      where: { pubgId: userInfo.id },
      update: {
        nickname: userInfo.name,
      },
      create: {
        pubgId: userInfo.id,
        nickname: userInfo.name,
      },
    });
  }

  /**
   * 检查用户信息是否需要更新
   * @param lastUpdated 最后更新时间
   * @returns 是否需要更新
   */
  private shouldUpdateUser(lastUpdated: Date): boolean {
    // 检查上次更新时间是否超过缓存过期时间（1天）
    return Date.now() - lastUpdated.getTime() > USER_CACHE_EXPIRY_MS;
  }

  /**
   * 根据昵称获取用户 ID（仅查询数据库）
   */
  async getUserIdByNickname(nickname: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { nickname },
      select: { pubgId: true },
    });
    return user?.pubgId ?? null;
  }
}
