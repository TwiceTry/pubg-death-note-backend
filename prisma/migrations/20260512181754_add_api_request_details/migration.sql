-- CreateTable
CREATE TABLE "api_request_details" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "tokenUsed" TEXT NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "responseData" TEXT,
    "endpoint" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "api_stats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "endpoint" TEXT NOT NULL,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
    "totalResponseTime" REAL NOT NULL DEFAULT 0,
    "avgResponseTime" REAL NOT NULL DEFAULT 0,
    "lastRequestAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "api_request_details_requestTime_idx" ON "api_request_details"("requestTime");

-- CreateIndex
CREATE INDEX "api_request_details_endpoint_idx" ON "api_request_details"("endpoint");

-- CreateIndex
CREATE INDEX "api_request_details_success_idx" ON "api_request_details"("success");

-- CreateIndex
CREATE UNIQUE INDEX "api_stats_endpoint_key" ON "api_stats"("endpoint");
