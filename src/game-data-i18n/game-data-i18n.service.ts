import { Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface GameDataI18n {
  maps: Record<string, string>;
  gameModes: Record<string, string>;
  weapons: Record<string, string>;
}

@Injectable()
export class GameDataI18nService implements OnModuleInit {
  private i18nData: GameDataI18n | null = null;

  onModuleInit() {
    const filePath = join(__dirname, 'game-data-i18n.json');
    const raw = readFileSync(filePath, 'utf-8');
    this.i18nData = JSON.parse(raw);
  }

  getI18nData(): GameDataI18n {
    return this.i18nData!;
  }

  translateMap(mapId: string): string {
    return this.i18nData?.maps[mapId] || mapId;
  }

  translateGameMode(modeId: string): string {
    return this.i18nData?.gameModes[modeId] || modeId;
  }

  translateWeapon(weaponId: string): string {
    return this.i18nData?.weapons[weaponId] || weaponId;
  }
}
