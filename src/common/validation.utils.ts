import { BadRequestException } from '@nestjs/common';

export function validatePaginationParams(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const pageNum = page ? parseInt(page, 10) : 1;
  const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 10;

  if (isNaN(pageNum) || pageNum < 1) {
    throw new BadRequestException('page must be a positive integer');
  }
  if (isNaN(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > 50) {
    throw new BadRequestException('pageSize must be between 1 and 50');
  }

  return { page: pageNum, pageSize: pageSizeNum };
}

export function validateNickname(nickname: string): void {
  const NICKNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{3,15}$/;
  if (!NICKNAME_REGEX.test(nickname)) {
    throw new BadRequestException(
      'Invalid nickname format. Must be 4-16 characters, only letters, numbers, underscores, and hyphens allowed.',
    );
  }
}

export function validateUserId(userId: string): void {
  const USER_ID_PREFIX = 'account.';
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new BadRequestException('userId is required');
  }
  if (!userId.startsWith(USER_ID_PREFIX)) {
    throw new BadRequestException('Invalid user ID format');
  }
}

export function validateDate(dateStr: string, fieldName = 'date'): void {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    throw new BadRequestException(`${fieldName} must be in YYYY-MM-DD format`);
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} is not a valid date`);
  }
}

export function validateMatchId(matchId: string, minLength = 32): void {
  if (!matchId || typeof matchId !== 'string' || matchId.length < minLength) {
    throw new BadRequestException(`Invalid match ID format. Must be at least ${minLength} characters.`);
  }
}
