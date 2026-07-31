import { PrismaClient } from "@prisma/client";
import { mockPrismaClient } from "./mock/client";

// When USE_MOCK_DB=true, return the in-memory mock client — no DB connection needed.
// All other env vars (DATABASE_URL etc.) are still read from .env but not used.
const USE_MOCK = process.env.USE_MOCK_DB === "true";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

declare global {
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

// Lazily constructed — `next build`'s "collecting page data" step imports
// this module (transitively, via any route that imports prisma) just to
// inspect route exports, with no request ever coming in and, critically,
// with DATABASE_URL not yet set (it's a Vault-injected RUNTIME secret, see
// scripts/start.sh — Vault only runs once the container actually starts).
// Eagerly constructing PrismaClient at module-evaluation time read
// process.env.DATABASE_URL immediately and crashed the whole build with
// "Invalid value undefined for datasource db" the moment any route imported
// prisma. The Proxy below defers both the env read and the real construction
// until the first actual property access, which only happens at request
// time — by then the env var is genuinely present. Methods are bound to the
// real client so `this` inside e.g. $transaction/$queryRaw still resolves
// correctly (Prisma's own methods rely on their internal `this`, which would
// otherwise be the Proxy, not the real client).
let realClient: PrismaClient | null = null;
function getRealClient(): PrismaClient {
  if (!realClient) {
    realClient = createRealClient();
    if (process.env.NODE_ENV !== "production") global.__prisma = realClient;
  }
  return realClient;
}

export const prisma: AnyPrisma = USE_MOCK
  ? mockPrismaClient
  : new Proxy({} as AnyPrisma, {
      get(_target, prop) {
        const client = getRealClient() as AnyPrisma;
        const value = client[prop];
        return typeof value === "function" ? value.bind(client) : value;
      },
    });

if (USE_MOCK) {
  console.log("[db] Running in mock mode — no database connection.");
}
