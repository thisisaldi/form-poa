import { PrismaClient } from "@prisma/client";
import { mockPrismaClient } from "./mock/client";

// When USE_MOCK_DB=true, return the in-memory mock client — no DB connection needed.
// All other env vars (DATABASE_URL etc.) are still read from .env but not used.
const USE_MOCK = process.env.USE_MOCK_DB === "true";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createRealClient(): PrismaClient {
  return (
    global.__prisma ??
    new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    })
  );
}

export const prisma: AnyPrisma = USE_MOCK
  ? mockPrismaClient
  : (() => {
      const client = createRealClient();
      if (process.env.NODE_ENV !== "production") global.__prisma = client;
      return client;
    })();

if (USE_MOCK) {
  console.log("[db] Running in mock mode — no database connection.");
}
