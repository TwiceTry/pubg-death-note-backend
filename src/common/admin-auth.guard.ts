// src/common/admin-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly adminToken: string;

  constructor(private configService: ConfigService) {
    this.adminToken = this.configService.get<string>('ADMIN_API_TOKEN') || '';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['x-admin-token'];

    if (!authHeader || authHeader !== this.adminToken) {
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    return true;
  }
}
