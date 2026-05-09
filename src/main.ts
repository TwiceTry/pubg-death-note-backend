import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DualOutputLoggerService } from './common/dual-output-logger.service';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ============================================================
// 常量
// ============================================================

const ADMIN_TOKEN_FILE = process.env.NODE_ENV === 'production'
  ? join('/app/data', '.admin-token')
  : join(process.cwd(), '.admin-token');

// ============================================================
// 辅助函数
// ============================================================

/**
 * 加载或生成 Admin API Token
 */
function loadOrGenerateAdminToken(logger: DualOutputLoggerService): string {
  if (process.env.ADMIN_API_TOKEN) {
    writeFileSync(ADMIN_TOKEN_FILE, process.env.ADMIN_API_TOKEN);
    logger.log('Admin API token loaded from environment and saved to file', 'Bootstrap');
    return process.env.ADMIN_API_TOKEN;
  }

  if (existsSync(ADMIN_TOKEN_FILE)) {
    const token = readFileSync(ADMIN_TOKEN_FILE, 'utf-8').trim();
    logger.log('Admin API token loaded from file', 'Bootstrap');
    return token;
  }

  const token = randomBytes(32).toString('hex');
  writeFileSync(ADMIN_TOKEN_FILE, token);
  logger.log(`Generated admin API token: ${token}`, 'Bootstrap');
  logger.log('Token saved to .admin-token file', 'Bootstrap');
  return token;
}

// ============================================================
// 启动入口
// ============================================================

async function bootstrap() {
  const logger = new DualOutputLoggerService();

  process.env.ADMIN_API_TOKEN = loadOrGenerateAdminToken(logger);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: true,
  });

  const publicPath = join(__dirname, '..', 'public');

  app.useStaticAssets(publicPath);
  app.setGlobalPrefix('api/v1');

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/n/:nickname', (req: any, res: any) => {
    res.sendFile(join(publicPath, 'index.html'));
  });

  logger.log(`Starting server on port ${process.env.PORT ?? 3000}`, 'Bootstrap');

  await app.listen(process.env.PORT ?? 3000);

  logger.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}/api/v1`, 'Bootstrap');
}

bootstrap();
