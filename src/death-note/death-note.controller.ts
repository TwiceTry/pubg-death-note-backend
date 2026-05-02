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

@Controller('death-note')
export class DeathNoteController {
  constructor(
    private readonly deathNoteService: DeathNoteService,
    private readonly logger: DualOutputLoggerService,
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
   * 查询死亡笔记生成状态
   * GET /api/v1/death-note/nickname/:nickname/status
   */
  @Get('nickname/:nickname/status')
  async getDeathNoteGenerationStatus(@Param('nickname') nickname: string) {
    try {
      validateNickname(nickname);
      const result = await this.deathNoteService.getDeathNoteGenerationStatus(nickname);
      return this.successResponse(result);
    } catch (error) {
      this.logger.error(`Error getting death note status for ${nickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to get death note status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
   * 获取死亡笔记数据
   * GET /api/v1/death-note/nickname/:nickname
   */
  @Get('nickname/:nickname')
  async getDeathNoteByNickname(@Param('nickname') nickname: string) {
    try {
      validateNickname(nickname);
      const result = await this.deathNoteService.getDeathNoteByNickname(nickname);
      
      if (result.error) {
        return this.errorResponse(result.error);
      }
      
      return this.successResponse(result);
    } catch (error) {
      this.logger.error(`Error getting death note for ${nickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to get death note data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 分页获取死亡笔记数据（按天分组）
   * GET /api/v1/death-note/nickname/:nickname/matches?page=1&pageSize=10
   */
  @Get('nickname/:nickname/matches')
  async getDeathNoteMatches(
    @Param('nickname') nickname: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    try {
      validateNickname(nickname);
      
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
    return this.successResponse({
      maps: {
        'Desert_Main': '米拉玛',
        'Miramar': '米拉玛',
        'Kiki_Main': '艾伦格',
        'Erangel_Main': '艾伦格',
        'Erangel': '艾伦格',
        'Savage_Main': '萨诺',
        'Sanhok': '萨诺',
        'DihorOtok_Main': '维寒迪',
        'Vikendi_Main': '维寒迪',
        'Vikendi': '维寒迪',
        'Baltic_Main': '卡拉金',
        'Karakin_Baltic': '卡拉金',
        'Karakin': '卡拉金',
        'Paramo_Paranal': '帕拉莫',
        'Paramo': '帕拉莫',
        'Tiger_Main': '泰戈',
        'Taego_Main': '泰戈',
        'Taego': '泰戈',
        'Chimera_Main': '帝斯顿',
        'Deston_Main': '帝斯顿',
        'Deston': '帝斯顿',
        'Haven': '黑文',
        'Neon_Main': '荣都',
        'Rondo_Main': '荣都',
        'Rondo': '荣都',
        'Range_Main': '训练场',
        'Summerland_Main': '度假岛',
      },
      gameModes: {
        'squad-fpp': '四排 FPP',
        'squad': '四排 TPP',
        'duo-fpp': '双排 FPP',
        'duo': '双排 TPP',
        'solo-fpp': '单排 FPP',
        'solo': '单排 TPP',
      },
      weapons: {
        'WeapAK47_C': 'AKM',
        'WeapM16A4_C': 'M16A4',
        'WeapSCAR-L_C': 'SCAR-L',
        'WeapQBZ95_C': 'QBZ95',
        'WeapBerylM762_C': 'Beryl M762',
        'WeapGroza_C': 'Groza',
        'WeapAUG_C': 'AUG',
        'WeapG36C_C': 'G36C',
        'WeapM416_C': 'M416',
        'WeapHK416_C': 'M416',
        'WeapMini14_C': 'Mini14',
        'WeapSKS_C': 'SKS',
        'WeapVSS_C': 'VSS',
        'WeapMk14_C': 'Mk14',
        'WeapSLR_C': 'SLR',
        'WeapQBU88_C': 'QBU',
        'WeapKar98k_C': 'Kar98k',
        'WeapM24_C': 'M24',
        'WeapAWM_C': 'AWM',
        'WeapWin94_C': 'Win94',
        'WeapMosin_C': '莫辛纳甘',
        'WeapUMP_C': 'UMP45',
        'WeapVector_C': 'Vector',
        'WeapUzi_C': 'Uzi',
        'WeapMP5K_C': 'MP5K',
        'WeapBizon_C': '野牛冲锋枪',
        'WeapTommyGun_C': '汤姆逊',
        'WeapDP28_C': 'DP-28',
        'WeapM249_C': 'M249',
        'WeapMG3_C': 'MG3',
        'WeapS12K_C': 'S12K',
        'WeapS1897_C': 'S1897',
        'WeapS686_C': 'S686',
        'WeapDBS_C': 'DBS',
        'WeapSaiga12_C': 'Saiga-12',
        'WeapP92_C': 'P92',
        'WeapP1911_C': 'P1911',
        'WeapP18C_C': 'P18C',
        'WeapR1895_C': 'R1895',
        'WeapR45_C': 'R45',
        'WeapSawedoff_C': '短管霰弹枪',
        'WeapFlareGun_C': '信号枪',
        'WeapCrossbow_1_C': '十字弩',
        'WeapPan_C': '平底锅',
        'WeapMachete_C': '砍刀',
        'WeapSickle_C': '镰刀',
        'WeapCowbar_C': '撬棍',
        'BombGrenade_C': '手雷',
        'BombMolotov_C': '燃烧瓶',
        'BombStickyGrenade_C': '粘性炸弹',
        'BombSmoke_C': '烟雾弹',
        'PlayerMale_A_C': '拳头',
        'PlayerFemale_A_C': '拳头',
        'Vehicle': '载具',
        'Dacia': '达契亚',
        'UAZ': 'UAZ',
        'Bus': '公交车',
        'PickUpTruck': '皮卡',
        'Motorcycle': '摩托车',
        'Buggy': '越野车',
        'Boat': '船',
        'JetSki': '摩托艇',
        'Snowmobile': '雪地摩托',
        'Snowbike': '雪地自行车',
        'BRDM': '装甲车',
        'Mirado': '米拉多',
        'Rony': '罗尼',
        'Scooter': '踏板车',
        'TukTukTuk': '突突车',
        'MotorcycleCart': '三轮摩托',
        'PonyCoupe': '野马',
        'Porter': '货车',
        'Quad': '四轮摩托',
        'SideCar': '边三轮',
        'SnowCat': '雪地猫',
        'Truck': '卡车',
        'Van': '面包车',
        'WaterSki': '滑水板',
        'DirtBike': '越野摩托',
        'PillarCar': '警车',
        'CoupeRB': '跑车',
        'AirDrop': '空投',
        'Bluezone': '蓝圈',
        'Redzone': '红区',
        'Fall': '坠落',
        'Drown': '溺水',
      },
    });
  }

  /**
   * 请求生成死亡笔记
   * POST /api/v1/death-note/nickname/:nickname/generate
   */
  @Post('nickname/:nickname/generate')
  async requestDeathNoteGeneration(@Param('nickname') nickname: string) {
    try {
      validateNickname(nickname);
      const result = await this.deathNoteService.requestDeathNoteGeneration(nickname);
      return this.successResponse(result, 'Death note generation task created');
    } catch (error) {
      this.logger.error(`Error requesting death note generation for ${nickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to request death note generation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 强制重新生成死亡笔记
   * POST /api/v1/death-note/nickname/:nickname/generate/force
   */
  @Post('nickname/:nickname/generate/force')
  async forceDeathNoteGeneration(@Param('nickname') nickname: string) {
    try {
      validateNickname(nickname);
      const result = await this.deathNoteService.forceDeathNoteGeneration(nickname);
      return this.successResponse(result, 'Force death note generation task created');
    } catch (error) {
      this.logger.error(`Error force generating death note for ${nickname}:`, error);
      throw new HttpException(
        error.message || 'Failed to force generate death note',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 手动刷新赛季信息
   * POST /api/v1/death-note/seasons/refresh
   */
  @Post('seasons/refresh')
  async refreshSeasons() {
    try {
      const result = await this.deathNoteService.refreshSeasons();
      if (result.success) {
        return this.successResponse(result, 'Seasons refreshed successfully');
      }
      return this.errorResponse(result.error || 'Failed to refresh seasons');
    } catch (error) {
      this.logger.error(`Error refreshing seasons:`, error);
      throw new HttpException(
        error.message || 'Failed to refresh seasons',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
