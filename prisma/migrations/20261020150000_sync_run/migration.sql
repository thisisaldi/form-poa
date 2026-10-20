-- Scheduler run history for Admin → Scheduler (docs/scheduler-monitor/).
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" TEXT,
    "error" TEXT,
    "detail" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SyncRun_job_startedAt_idx" ON "SyncRun"("job", "startedAt" DESC);
