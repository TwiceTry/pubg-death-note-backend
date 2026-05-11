-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_matches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "ranking" INTEGER,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("pubg_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_matches_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_matches" ("createdAt", "id", "match_id", "ranking", "updatedAt", "user_id") SELECT "createdAt", "id", "match_id", "ranking", "updatedAt", "user_id" FROM "user_matches";
DROP TABLE "user_matches";
ALTER TABLE "new_user_matches" RENAME TO "user_matches";
CREATE INDEX "user_matches_user_id_idx" ON "user_matches"("user_id");
CREATE INDEX "user_matches_match_id_idx" ON "user_matches"("match_id");
CREATE UNIQUE INDEX "user_matches_user_id_match_id_key" ON "user_matches"("user_id", "match_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
