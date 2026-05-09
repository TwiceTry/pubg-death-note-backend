/*
  Warnings:

  - You are about to drop the column `actualEndTime` on the `death_note_generations` table. All the data in the column will be lost.
  - You are about to drop the column `estimatedEndTime` on the `death_note_generations` table. All the data in the column will be lost.
  - You are about to drop the column `firstGenerationDuration` on the `death_note_generations` table. All the data in the column will be lost.
  - You are about to drop the column `lastIncrementalTime` on the `death_note_generations` table. All the data in the column will be lost.
  - You are about to drop the column `requestTime` on the `death_note_generations` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KillEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" TEXT NOT NULL,
    "killerId" TEXT,
    "killerName" TEXT,
    "victimId" TEXT NOT NULL,
    "victimName" TEXT NOT NULL,
    "weaponId" TEXT NOT NULL,
    "distance" REAL NOT NULL,
    "isHeadshot" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "KillEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_KillEvent" ("distance", "id", "isHeadshot", "killerId", "killerName", "matchId", "timestamp", "victimId", "victimName", "weaponId") SELECT "distance", "id", "isHeadshot", "killerId", "killerName", "matchId", "timestamp", "victimId", "victimName", "weaponId" FROM "KillEvent";
DROP TABLE "KillEvent";
ALTER TABLE "new_KillEvent" RENAME TO "KillEvent";
CREATE INDEX "KillEvent_matchId_idx" ON "KillEvent"("matchId");
CREATE INDEX "KillEvent_killerId_idx" ON "KillEvent"("killerId");
CREATE INDEX "KillEvent_victimId_idx" ON "KillEvent"("victimId");
CREATE INDEX "KillEvent_killerName_idx" ON "KillEvent"("killerName");
CREATE INDEX "KillEvent_victimName_idx" ON "KillEvent"("victimName");
CREATE INDEX "KillEvent_killerId_timestamp_idx" ON "KillEvent"("killerId", "timestamp");
CREATE INDEX "KillEvent_victimId_timestamp_idx" ON "KillEvent"("victimId", "timestamp");
CREATE UNIQUE INDEX "KillEvent_matchId_victimId_timestamp_key" ON "KillEvent"("matchId", "victimId", "timestamp");
CREATE TABLE "new_death_note_generations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "isGenerated" BOOLEAN NOT NULL DEFAULT false,
    "dailyIncrementalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_death_note_generations" ("createdAt", "dailyIncrementalEnabled", "id", "isGenerated", "updatedAt", "userId") SELECT "createdAt", "dailyIncrementalEnabled", "id", "isGenerated", "updatedAt", "userId" FROM "death_note_generations";
DROP TABLE "death_note_generations";
ALTER TABLE "new_death_note_generations" RENAME TO "death_note_generations";
CREATE UNIQUE INDEX "death_note_generations_userId_key" ON "death_note_generations"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
