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
        'Desert': '米拉玛',
        'Miramar': '米拉玛',
        'Miramar_Main': '米拉玛',
        'Kiki_Main': '艾伦格',
        'Kiki': '艾伦格',
        'Erangel_Main': '艾伦格',
        'Erangel': '艾伦格',
        'Savage_Main': '萨诺',
        'Savage': '萨诺',
        'Sanhok': '萨诺',
        'Sanhok_Main': '萨诺',
        'DihorOtok_Main': '维寒迪',
        'DihorOtok': '维寒迪',
        'Vikendi_Main': '维寒迪',
        'Vikendi': '维寒迪',
        'Baltic_Main': '卡拉金',
        'Baltic': '卡拉金',
        'Karakin_Baltic': '卡拉金',
        'Karakin': '卡拉金',
        'Paramo_Paranal': '帕拉莫',
        'Paramo': '帕拉莫',
        'Tiger_Main': '泰戈',
        'Tiger': '泰戈',
        'Taego_Main': '泰戈',
        'Taego': '泰戈',
        'Chimera_Main': '帝斯顿',
        'Deston_Main': '帝斯顿',
        'Deston': '帝斯顿',
        'Haven': '黑文',
        'Haven_Main': '黑文',
        'Neon_Main': '荣都',
        'Rondo_Main': '荣都',
        'Rondo': '荣都',
        'Range_Main': '训练场',
        'Range': '训练场',
        'Summerland_Main': '度假岛',
        'Summerland': '度假岛',
      },
      gameModes: {
        'squad-fpp': '四排 FPP',
        'squad': '四排 TPP',
        'duo-fpp': '双排 FPP',
        'duo': '双排 TPP',
        'solo-fpp': '单排 FPP',
        'solo': '单排 TPP',
        'squad-fpp-arcade': '四排 FPP (街机)',
        'squad-arcade': '四排 TPP (街机)',
        'duo-fpp-arcade': '双排 FPP (街机)',
        'duo-arcade': '双排 TPP (街机)',
        'solo-fpp-arcade': '单排 FPP (街机)',
        'solo-arcade': '单排 TPP (街机)',
        'squad-fpp-pro': '四排 FPP (竞技)',
        'squad-pro': '四排 TPP (竞技)',
        'duo-fpp-pro': '双排 FPP (竞技)',
        'duo-pro': '双排 TPP (竞技)',
        'solo-fpp-pro': '单排 FPP (竞技)',
        'solo-pro': '单排 TPP (竞技)',
        'zombie-mode': '僵尸模式',
        'war-mode': '战场模式',
      },
      weapons: {
        'WeapAK47_C': 'AKM',
        'WeapAK47_Starter_C': 'AKM',
        'WeapM16A4_C': 'M16A4',
        'WeapM16A4_Starter_C': 'M16A4',
        'WeapSCAR-L_C': 'SCAR-L',
        'WeapSCAR_L_C': 'SCAR-L',
        'WeapSCAR-L_Starter_C': 'SCAR-L',
        'WeapQBZ95_C': 'QBZ95',
        'WeapQBZ95_Starter_C': 'QBZ95',
        'WeapBerylM762_C': 'Beryl M762',
        'WeapBerylM762_Starter_C': 'Beryl M762',
        'WeapGroza_C': 'Groza',
        'WeapAUG_C': 'AUG',
        'WeapAUG_Starter_C': 'AUG',
        'WeapG36C_C': 'G36C',
        'WeapG36C_Starter_C': 'G36C',
        'WeapM416_C': 'M416',
        'WeapM416_Starter_C': 'M416',
        'WeapHK416_C': 'M416',
        'WeapMini14_C': 'Mini14',
        'WeapMini14_Starter_C': 'Mini14',
        'WeapSKS_C': 'SKS',
        'WeapSKS_Starter_C': 'SKS',
        'WeapVSS_C': 'VSS',
        'WeapMk14_C': 'Mk14',
        'WeapSLR_C': 'SLR',
        'WeapSLR_Starter_C': 'SLR',
        'WeapQBU88_C': 'QBU',
        'WeapQBU88_Starter_C': 'QBU',
        'WeapKar98k_C': 'Kar98k',
        'WeapKar98k_Starter_C': 'Kar98k',
        'WeapM24_C': 'M24',
        'WeapM24_Starter_C': 'M24',
        'WeapAWM_C': 'AWM',
        'WeapWin94_C': 'Win94',
        'WeapWin94_Starter_C': 'Win94',
        'WeapWinchester_C': 'Win94',
        'WeapMosin_C': '莫辛纳甘',
        'WeapMk12_C': 'Mk12',
        'WeapDragunov_C': '德拉贡诺夫',
        'WeapLynxAMR_C': 'Lynx AMR',
        'WeapL6_C': 'Lynx AMR',
        'WeapUMP_C': 'UMP45',
        'WeapUMP_Starter_C': 'UMP45',
        'WeapVector_C': 'Vector',
        'WeapVector_Starter_C': 'Vector',
        'WeapUzi_C': 'Uzi',
        'WeapUzi_Starter_C': 'Uzi',
        'WeapUZI_C': 'Uzi',
        'WeapMP5K_C': 'MP5K',
        'WeapBizon_C': '野牛冲锋枪',
        'WeapBizon_Starter_C': '野牛冲锋枪',
        'WeapBizonPP19_C': '野牛冲锋枪',
        'WeapTommyGun_C': '汤姆逊',
        'WeapTommyGun_Starter_C': '汤姆逊',
        'WeapThompson_C': '汤姆逊',
        'WeapDP28_C': 'DP-28',
        'WeapM249_C': 'M249',
        'WeapMG3_C': 'MG3',
        'WeapS12K_C': 'S12K',
        'WeapS1897_C': 'S1897',
        'WeapS686_C': 'S686',
        'WeapDBS_C': 'DBS',
        'WeapSaiga12_C': 'Saiga-12',
        'WeapO12_C': 'O12',
        'WeapP92_C': 'P92',
        'WeapP92_Starter_C': 'P92',
        'WeapP1911_C': 'P1911',
        'WeapP1911_Starter_C': 'P1911',
        'WeapP18C_C': 'P18C',
        'WeapR1895_C': 'R1895',
        'WeapR45_C': 'R45',
        'WeapSawedoff_C': '短管霰弹枪',
        'WeapFlareGun_C': '信号枪',
        'WeapCrossbow_1_C': '十字弩',
        'WeapPan_C': '平底锅',
        'WeapPanProjectile_C': '平底锅',
        'WeapMachete_C': '砍刀',
        'WeapSickle_C': '镰刀',
        'WeapCowbar_C': '撬棍',
        'WeapNagantM1895_C': 'R1895',
        'WeapHP18_C': 'P18C',
        'WeapG18_C': 'P18C',
        'WeapM1911_C': 'P1911',
        'WeapM9_C': 'M9',
        'WeapPickaxe_C': '镐',
        'WeapACE32_C': 'ACE 32',
        'WeapJS9_C': 'JS9',
        'WeapFNFal_C': 'SLR',
        'WeapBerreta686_C': 'S686',
        'WeapK2_C': 'K2',
        'WeapMk47Mutant_C': 'Mk47 Mutant',
        'WeapP90_C': 'P90',
        'WeapFamasG2_C': 'FAMAS G2',
        'BombGrenade_C': '手雷',
        'BombMolotov_C': '燃烧瓶',
        'BombStickyGrenade_C': '粘性炸弹',
        'BombSmoke_C': '烟雾弹',
        'BombC4_C': 'C4',
        'ProjGrenade_C': '手雷',
        'ProjC4_C': 'C4',
        'PlayerMale_A_C': '拳头',
        'PlayerFemale_A_C': '拳头',
        'UltAIPawn_Base_Male_C': '拳头',
        'UltAIPawn_Base_Female_C': '拳头',
        'BP_FireEffectController_C': '燃烧',
        'BP_MolotovFireDebuff_C': '燃烧瓶',
        'JerrycanFire': '燃烧瓶',
        'Thompson': '汤姆逊',
        'Berreta686': 'S686',
        'Winchester': 'Win94',
        'Bluezonebomb_EffectActor_C': '蓝圈',
        'TslGameModeBase_BattleRoyaleBP_C': '蓝圈',
        'BP_Blanc_C': '蓝圈',
        'BP_Blanc_Esports_C': '蓝圈',
        'PanzerFaust100M_Projectile_C': '铁拳火箭',
        'None': '未知',
        'Vehicle': '载具',
        'Dacia': '达契亚',
        'Dacia_A_01_v2_C': '达契亚',
        'Dacia_A_02_v2_C': '达契亚',
        'Dacia_A_03_v2_C': '达契亚',
        'Dacia_A_03_v2_Esports_C': '达契亚',
        'UAZ': 'UAZ',
        'Uaz_C_01_C': 'UAZ',
        'Uaz_B_01_C': 'UAZ',
        'Uaz_B_01_esports_C': 'UAZ',
        'Bus': '公交车',
        'BP_PicoBus_C': '小巴',
        'PickUpTruck': '皮卡',
        'BP_PickupTruck_A_03_C': '皮卡',
        'Motorcycle': '摩托车',
        'Buggy': '越野车',
        'Buggy_A_01_C': '越野车',
        'Buggy_A_02_C': '越野车',
        'Boat': '船',
        'JetSki': '摩托艇',
        'Snowmobile': '雪地摩托',
        'Snowbike': '雪地自行车',
        'BRDM': '装甲车',
        'BP_BRDM_C': '装甲车',
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
        'BP_ATV_C': 'ATV',
        'PillarCar': '警车',
        'CoupeRB': '跑车',
        'BP_CoupeRB_C': '跑车',
        'AirDrop': '空投',
        'Bluezone': '蓝圈',
        'Redzone': '红区',
        'Fall': '坠落',
        'Drown': '溺水',
        'Death': '死亡',
        'BlackZone': '黑圈',
        'BP_Tiger_GasStationB_Gaspump_C': '加油站',
        'BP_DesertTslGasPump_C': '加油站',
        'BP_Baltic_GasPump_C': '加油站',
      },
    });
  }

  /**
   * 请求生成死亡笔记（已停用，仅保留管理后台生成）
   * POST /api/v1/death-note/nickname/:nickname/generate
   */
  // @Post('nickname/:nickname/generate')
  // async requestDeathNoteGeneration(@Param('nickname') nickname: string) {
  //   try {
  //     validateNickname(nickname);
  //     const result = await this.deathNoteService.requestDeathNoteGeneration(nickname);
  //     return this.successResponse(result, 'Death note generation task created');
  //   } catch (error) {
  //     this.logger.error(`Error requesting death note generation for ${nickname}:`, error);
  //     throw new HttpException(
  //       error.message || 'Failed to request death note generation',
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   }
  // }

  /**
   * 强制重新生成死亡笔记（已停用，仅保留管理后台生成）
   * POST /api/v1/death-note/nickname/:nickname/generate/force
   */
  // @Post('nickname/:nickname/generate/force')
  // async forceDeathNoteGeneration(@Param('nickname') nickname: string) {
  //   try {
  //     validateNickname(nickname);
  //     const result = await this.deathNoteService.forceDeathNoteGeneration(nickname);
  //     return this.successResponse(result, 'Force death note generation task created');
  //   } catch (error) {
  //     this.logger.error(`Error force generating death note for ${nickname}:`, error);
  //     throw new HttpException(
  //       error.message || 'Failed to force generate death note',
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   }
  // }

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
