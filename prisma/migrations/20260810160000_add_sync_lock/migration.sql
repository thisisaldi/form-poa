-- Cross-replica mutex for in-process schedulers (see SyncLock model comment).
CREATE TABLE "SyncLock" (
    "key" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncLock_pkey" PRIMARY KEY ("key")
);
