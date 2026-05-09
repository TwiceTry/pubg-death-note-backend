// src/death-note/death-note.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  BadRequestException,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { DeathNoteService } from './death-note.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { validateNickname, validatePaginationParams } from '../common/validation.utils';
import { GameDataI18nService } from '../game-data-i18n/game-data-i18n.service';

@Controller('death-note')
export class DeathNoteController {
  constructor(
    private readonly deathNoteService: DeathNoteService,
    private readonly logger: DualOutputLoggerService,
    private readonly gameDataI18nService: GameDataI18nService,
  ) {}

  /**
   * 构建成功响应
   * @param data 响应数据
   * @param message 可选的成功消息
   * @returns 标准成功响应对象
   */
  private successResponse(data: Record<string, any>, message?: string) {
    return {
      success: true,
      ...(message && { message }),
      ...data,
    };
  }

  /**
   * 构建错误响应
   * @param message 错误消息
   * @param error 可选的错误详情
   * @returns 标准错误响应对象
   */
  private errorResponse(message: string, error?: any) {
    return {
      success: false,
      message,
      ...(error && { error }),
    };
  }

  /**
   * 查询当前用户是否击杀过指定昵称的玩家
   * GET /api/v1/death-note/nickname/:nickname/victim/:victimNickname
   */
  @Get('nickname/:nickname/victim/:victimNickname')
  async getVictimKillHistory(
    @Param('nickname') nickname: string,
    @Param('victimNickname') victimNickname: string,
  ) {
    try {
      validateNickname(nickname);
      validateNickname(victimNickname);
      
      const result = await this.deathNoteService.getVictimKillHistory(nickname, victimNickname);
      
      if (result.totalKills === 0) {
        return this.successResponse(result, `${nickname} has never killed ${victimNickname}`);
      }
      
      return this.successResponse(result, `${nickname} has killed ${victimNickname} ${result.totalKills} time(s)`);
    } catch (error) {
      this.logger.error(`Error getting victim kill history for ${nickname} -> ${victimNickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to get victim kill history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 查询指定昵称的玩家是否击杀过当前用户
   * GET /api/v1/death-note/nickname/:nickname/killed-by/:killerNickname
   */
  @Get('nickname/:nickname/killed-by/:killerNickname')
  async getKilledByHistory(
    @Param('nickname') nickname: string,
    @Param('killerNickname') killerNickname: string,
  ) {
    try {
      validateNickname(nickname);
      validateNickname(killerNickname);
      
      const result = await this.deathNoteService.getKilledByHistory(nickname, killerNickname);
      
      if (result.totalDeaths === 0) {
        return this.successResponse(result, `${killerNickname} has never killed ${nickname}`);
      }
      
      return this.successResponse(result, `${killerNickname} has killed ${nickname} ${result.totalDeaths} time(s)`);
    } catch (error) {
      this.logger.error(`Error getting killed by history for ${nickname} <- ${killerNickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to get killed by history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 分页获取死亡笔记数据（按天分组）
   * GET /api/v1/death-note/nickname/:nickname/matches?page=1&pageSize=10
   * GET /api/v1/death-note/nickname/:nickname/matches?date=2024-01-01
   */
  @Get('nickname/:nickname/matches')
  async getDeathNoteMatches(
    @Param('nickname') nickname: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('date') date?: string,
  ) {
    try {
      validateNickname(nickname);
      
      if (date) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
          throw new HttpException('Invalid date format, use YYYY-MM-DD', HttpStatus.BAD_REQUEST);
        }
        const result = await this.deathNoteService.getDeathNoteByDate(nickname, date);
        return this.successResponse(result);
      }
      
      const { page: pageNum, pageSize: pageSizeNum } = validatePaginationParams(page, pageSize);
      
      const result = await this.deathNoteService.getDeathNotePaginated(nickname, pageNum, pageSizeNum);
      return this.successResponse(result);
    } catch (error) {
      this.logger.error(`Error getting death note matches for ${nickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to get death note matches',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取游戏数据翻译对照表
   * GET /api/v1/death-note/i18n/game-data
   */
  @Get('i18n/game-data')
  getGameDataI18n() {
    return this.successResponse(this.gameDataI18nService.getI18nData());
  }
}
