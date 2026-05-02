export interface LogContext {
  userId?: string;
  nickname?: string;
  matchId?: string;
  taskId?: string;
  [key: string]: unknown;
}

export function formatLogMessage(context: LogContext, message: string): string {
  const contextParts = Object.entries(context)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);

  const contextStr = contextParts.length > 0 ? ` [${contextParts.join(', ')}]` : '';
  return `${message}${contextStr}`;
}

export function createLogContext(context: Partial<LogContext>): LogContext {
  return { ...context };
}
