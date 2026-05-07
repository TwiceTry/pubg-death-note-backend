import { Module } from '@nestjs/common';
import { GameDataI18nService } from './game-data-i18n.service';

@Module({
  providers: [GameDataI18nService],
  exports: [GameDataI18nService],
})
export class GameDataI18nModule {}
