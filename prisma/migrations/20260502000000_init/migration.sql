-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapName" TEXT,
    "gameMode" TEXT,
    "playedAt" DATETIME NOT NULL,
    "dataPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KillEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" TEXT NOT NULL,
    "killerId" TEXT NOT NULL,
    "killerName" TEXT NOT NULL,
    "victimId" TEXT NOT NULL,
    "victimName" TEXT NOT NULL,
    "weaponId" TEXT NOT NULL,
    "distance" REAL NOT NULL,
    "isHeadshot" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "KillEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pubg_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "user_matches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("pubg_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_matches_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestType" TEXT NOT NULL,
    "lastRequest" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TEXT,
    "endDate" TEXT,
    "lastFetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "death_note_generations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "requestTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isGenerated" BOOLEAN NOT NULL DEFAULT false,
    "estimatedEndTime" DATETIME,
    "actualEndTime" DATETIME,
    "firstGenerationDuration" INTEGER,
    "lastIncrementalTime" DATETIME,
    "dailyIncrementalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeathNoteProgress" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "totalMatches" INTEGER NOT NULL,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "processedMatches" TEXT NOT NULL,
    "failedMatches" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "scheduled_task_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRun" DATETIME,
    "nextRun" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "heartbeat" DATETIME,
    "result" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "KillEvent_matchId_idx" ON "KillEvent"("matchId");

-- CreateIndex
CREATE INDEX "KillEvent_killerId_idx" ON "KillEvent"("killerId");

-- CreateIndex
CREATE INDEX "KillEvent_victimId_idx" ON "KillEvent"("victimId");

-- CreateIndex
CREATE INDEX "KillEvent_killerName_idx" ON "KillEvent"("killerName");

-- CreateIndex
CREATE INDEX "KillEvent_victimName_idx" ON "KillEvent"("victimName");

-- CreateIndex
CREATE INDEX "KillEvent_killerId_timestamp_idx" ON "KillEvent"("killerId", "timestamp");

-- CreateIndex
CREATE INDEX "KillEvent_victimId_timestamp_idx" ON "KillEvent"("victimId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "KillEvent_matchId_killerId_victimId_timestamp_key" ON "KillEvent"("matchId", "killerId", "victimId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "users_pubg_id_key" ON "users"("pubg_id");

-- CreateIndex
CREATE INDEX "user_matches_user_id_idx" ON "user_matches"("user_id");

-- CreateIndex
CREATE INDEX "user_matches_match_id_idx" ON "user_matches"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_matches_user_id_match_id_key" ON "user_matches"("user_id", "match_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_request_logs_requestType_key" ON "api_request_logs"("requestType");

-- CreateIndex
CREATE UNIQUE INDEX "death_note_generations_userId_key" ON "death_note_generations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_task_configs_type_key" ON "scheduled_task_configs"("type");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_type_idx" ON "tasks"("type");

-- CreateIndex
CREATE INDEX "tasks_userId_idx" ON "tasks"("userId");

