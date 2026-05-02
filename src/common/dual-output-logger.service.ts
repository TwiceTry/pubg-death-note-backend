import { LoggerService, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DualOutputLoggerService implements LoggerService {
  private logDir: string;
  private timezone: string;
  private maxFileSize = 10 * 1024 * 1024; // 10MB
  private maxFiles = 5;

  constructor(@Optional() configService?: ConfigService) {
    this.logDir = configService?.get<string>('LOG_DIR', './logs') ?? process.env.LOG_DIR ?? './logs';
    this.timezone = configService?.get<string>('TZ', 'Asia/Shanghai') ?? process.env.TZ ?? 'Asia/Shanghai';
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogFilePath(prefix: string): string {
    const date = this.formatTimestamp().split('T')[0];
    return path.join(this.logDir, `${prefix}-${date}.log`);
  }

  private formatTimestamp(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
  }

  private formatMessage(level: string, message: string, context?: string): string {
    const timestamp = this.formatTimestamp();
    const ctx = context ? `[${context}]` : '';
    return `[${timestamp}] [${level}] ${ctx} ${message}`;
  }

  private writeToFile(filePath: string, message: string): void {
    try {
      this.rotateFileIfNeeded(filePath);
      fs.appendFileSync(filePath, message + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private rotateFileIfNeeded(filePath: string): void {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size >= this.maxFileSize) {
        const timestamp = Date.now();
        const rotatedPath = `${filePath}.${timestamp}`;
        fs.renameSync(filePath, rotatedPath);
        this.cleanupOldFiles(filePath);
      }
    }
  }

  private cleanupOldFiles(basePath: string): void {
    const dir = path.dirname(basePath);
    const baseName = path.basename(basePath);
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith(baseName))
      .sort()
      .reverse();

    while (files.length > this.maxFiles) {
      const fileToRemove = files.pop();
      if (fileToRemove) {
        fs.unlinkSync(path.join(dir, fileToRemove));
      }
    }
  }

  log(message: string, context?: string): void {
    const formatted = this.formatMessage('LOG', message, context);
    console.log(formatted);
    this.writeToFile(this.getLogFilePath('app'), formatted);
  }

  error(message: string, trace?: string | unknown, context?: string): void {
    const formatted = this.formatMessage('ERROR', message, context);
    const traceStr = trace instanceof Error ? trace.stack : trace;
    const fullMessage = traceStr ? `${formatted}\n${traceStr}` : formatted;
    
    console.error(fullMessage);
    this.writeToFile(this.getLogFilePath('app'), fullMessage);
    this.writeToFile(this.getLogFilePath('error'), fullMessage);
  }

  warn(message: string, context?: string): void {
    const formatted = this.formatMessage('WARN', message, context);
    console.warn(formatted);
    this.writeToFile(this.getLogFilePath('app'), formatted);
  }

  debug(message: string, context?: string): void {
    const formatted = this.formatMessage('DEBUG', message, context);
    console.debug(formatted);
    this.writeToFile(this.getLogFilePath('app'), formatted);
  }

  verbose(message: string, context?: string): void {
    const formatted = this.formatMessage('VERBOSE', message, context);
    console.log(formatted);
    this.writeToFile(this.getLogFilePath('app'), formatted);
  }
}
