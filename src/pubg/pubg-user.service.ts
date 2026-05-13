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

  // ============================================================
  // 公开 API - 用户查询
  // ============================================================

  /**
   * 通过用户昵称获取用户信息
   * 
   * 功能说明：
   * - 优先从数据库缓存读取（1天内有效）
   * - 缓存过期时调用 API 获取最新信息
   * - 检测昵称变更并更新数据库
   * 
   * @param nickname - 用户昵称
   * @returns 用户信息，包含用户 ID 和昵称
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
   * 
   * 功能说明：
   * - 优先从数据库缓存读取（1天内有效）
   * - 缓存过期时调用 API 获取最新信息
   * - 更新数据库中的昵称
   * 
   * @param userId - 用户 ID
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
   * 根据昵称获取用户 ID（仅查询数据库）
   * 
   * 功能说明：
   * - 仅查询本地数据库，不调用 API
   * - 适用于只需要用户 ID 的场景
   * 
   * @param nickname - 用户昵称
   * @returns 用户 ID，未找到时返回 null
   */
  async getUserIdByNickname(nickname: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { nickname },
      select: { pubgId: true },
    });
    return user?.pubgId ?? null;
  }

  // ============================================================
  // 公开 API - 用户管理
  // ============================================================

  /**
   * 创建或更新用户信息
   * 
   * 功能说明：
   * - 使用 upsert 保证数据唯一性
   * - 用户存在时更新昵称，不存在时创建新记录
   * 
   * @param userInfo - 用户信息，包含 ID 和昵称
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
   * 根据昵称查询用户（返回完整用户记录）
   * 
   * 功能说明：
   * - 直接查询数据库，不调用 API
   * - 返回完整的用户记录，包含所有字段
   * 
   * @param nickname - 用户昵称
   * @returns 用户记录，未找到时返回 null
   */
  async findUserByNickname(nickname: string) {
    return this.prisma.user.findFirst({
      where: { nickname },
    });
  }

  /**
   * 删除用户
   * 
   * 功能说明：
   * - 根据用户 ID 删除用户记录
   * 
   * @param pubgId - PUBG 用户 ID
   */
  async deleteUser(pubgId: string) {
    return this.prisma.user.delete({ where: { pubgId } });
  }

  /**
   * 更新用户昵称
   * 
   * 功能说明：
   * - 直接更新数据库中的用户昵称
   * 
   * @param pubgId - PUBG 用户 ID
   * @param nickname - 新昵称
   */
  async updateUserNickname(pubgId: string, nickname: string) {
    return this.prisma.user.update({
      where: { pubgId },
      data: { nickname },
    });
  }

  // ============================================================
  // 私有方法 - 缓存管理
  // ============================================================

  /**
   * 检查用户信息是否需要更新
   * 
   * 功能说明：
   * - 判断上次更新时间是否超过缓存过期时间（1天）
   * 
   * @param lastUpdated - 最后更新时间
   * @returns 是否需要更新
   */
  private shouldUpdateUser(lastUpdated: Date): boolean {
    return Date.now() - lastUpdated.getTime() > USER_CACHE_EXPIRY_MS;
  }
}
