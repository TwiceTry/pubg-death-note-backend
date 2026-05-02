import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DualOutputLoggerService } from './common/dual-output-logger.service';
import { PrismaService } from './prisma/prisma.service';
import { TaskService } from './task/task.service';
import { PubgDeathNoteService } from './pubg/pubg-death-note.service';
import { join } from 'path';

async function bootstrap() {
  const logger = new DualOutputLoggerService();
  
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: true,
  });
  
  const publicPath = process.env.NODE_ENV === 'production'
    ? join(__dirname, '..', 'public')
    : join(__dirname, '..', '..', 'public');
  
  app.useStaticAssets(publicPath);
  app.setGlobalPrefix('api/v1');
  
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/n/:nickname', (req: any, res: any) => {
    res.sendFile(join(publicPath, 'index.html'));
  });
  
  await cleanupStaleTasks(app, logger);
  await resumeIncompleteTasks(app, logger);
  
  logger.log(`Starting server on port ${process.env.PORT ?? 3000}`, 'Bootstrap');
  
  await app.listen(process.env.PORT ?? 3000);
  
  logger.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}/api/v1`, 'Bootstrap');
}

async function cleanupStaleTasks(app: any, logger: DualOutputLoggerService) {
  try {
    const taskService = app.get(TaskService);
    const cleanedCount = await taskService.cleanupStaleTasks();
    
    if (cleanedCount > 0) {
      logger.log(`Cleaned up ${cleanedCount} stale running tasks`, 'Bootstrap');
    }
  } catch (error) {
    logger.error(`Failed to cleanup stale tasks:`, error, 'Bootstrap');
  }
}

async function resumeIncompleteTasks(app: any, logger: DualOutputLoggerService) {
  try {
    const prisma = app.get(PrismaService);
    const taskService = app.get(TaskService);
    const pubgDeathNoteService = app.get(PubgDeathNoteService);
    
    const incompleteGenerations = await prisma.deathNoteGeneration.findMany({
      where: { isGenerated: false },
    });

    if (incompleteGenerations.length === 0) {
      logger.log('No incomplete generations to resume', 'Bootstrap');
      return;
    }

    logger.log(`Found ${incompleteGenerations.length} incomplete generations, resuming...`, 'Bootstrap');

    for (const generation of incompleteGenerations) {
      try {
        const progress = await prisma.deathNoteProgress.findUnique({
          where: { userId: generation.userId },
        });

        if (progress) {
          const processedCount = JSON.parse(progress.processedMatches).length;
          logger.log(`Resuming user ${generation.userId}: ${processedCount} matches already processed`, 'Bootstrap');
          
          const hasRunning = await taskService.hasRunningTask(generation.userId);
          if (hasRunning) {
            logger.log(`User ${generation.userId} already has running task, skipping`, 'Bootstrap');
            continue;
          }
          
          await taskService.createAndExecuteTask(
            'death_note_resume',
            async (taskId: string) => {
              return await pubgDeathNoteService.resumeGeneration(generation.userId, taskId);
            },
            generation.userId,
          );
          
          logger.log(`Created resume task for user ${generation.userId}`, 'Bootstrap');
        } else {
          logger.warn(`No progress record for user ${generation.userId}, waiting for user to retry`, 'Bootstrap');
        }
      } catch (error) {
        logger.error(`Failed to resume user ${generation.userId}:`, error, 'Bootstrap');
      }
    }
  } catch (error) {
    logger.error(`Failed to resume incomplete tasks:`, error, 'Bootstrap');
  }
}

bootstrap();
