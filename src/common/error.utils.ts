import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function throwNotFoundError(message: string): never {
  throw new HttpException(message, HttpStatus.NOT_FOUND);
}

export function throwBadRequestError(message: string): never {
  throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

export function throwInternalError(message: string): never {
  throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
}

export function handleServiceError(error: unknown, context: string, logger: { error: (msg: string, err?: unknown) => void }): never {
  logger.error(`[${context}] ${error instanceof Error ? error.message : String(error)}`, error);
  
  if (error instanceof HttpException) {
    throw error;
  }
  
  throw new HttpException(
    error instanceof Error ? error.message : 'Internal server error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
