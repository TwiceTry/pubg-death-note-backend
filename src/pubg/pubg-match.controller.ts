// src/pubg/pubg-match.controller.ts
import {
  Controller,
} from '@nestjs/common';
import { PubgMatchService } from './pubg-match.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';

@Controller('pubg/matches')
export class PubgMatchController {
  constructor(
    private readonly pubgMatchService: PubgMatchService,
    private readonly logger: DualOutputLoggerService,
  ) {}
}
