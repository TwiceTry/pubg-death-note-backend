import { Module, Global } from '@nestjs/common';
import { DualOutputLoggerService } from './dual-output-logger.service';

@Global()
@Module({
  providers: [DualOutputLoggerService],
  exports: [DualOutputLoggerService],
})
export class LoggerModule {}
