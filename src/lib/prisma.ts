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

// Hardcoded rather than left to whatever's in DATABASE_URL's own
// ?connection_limit= — that string comes from a Vault secret in production
// (see scripts/start.sh), which this app doesn't control day-to-day, so the
// pool size silently reverting to Prisma's default (or an old low value
// someone set once) is invisible until the app is slow again under load
// (2026-07-31: "jadi agak lemot setelah banyak yang pakai" — the DB's own
// max_connections has headroom, this is a dedicated instance, see prior
// discussion). Bumping this constant is now the one place that changes it,
// independent of env/Vault config.
const CONNECTION_LIMIT = 50;

function withConnectionLimit(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set("connection_limit", String(CONNECTION_LIMIT));
    return url.toString();
  } catch {
    // Malformed URL — let Prisma surface its own connection error rather
    // than masking it here.
    return databaseUrl;
  }
}

function createRealClient(): PrismaClient {
  return (
    global.__prisma ??
    new PrismaClient({
      datasources: { db: { url: withConnectionLimit(process.env.DATABASE_URL!) } },
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
