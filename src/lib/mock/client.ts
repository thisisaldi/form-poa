/**
 * Mock Prisma client for local dev (USE_MOCK_DB=true).
 * Implements the subset of Prisma's API used by this app using in-memory arrays.
 * Write operations (create/update/upsert) mutate the in-memory arrays for the
 * session lifetime, so workflow transitions work end-to-end in mock mode.
 */

import { MOCK_USERS, MOCK_POAS, MOCK_AUDIT_LOGS, MOCK_LINE_ITEMS } from "./data";
import type { User, PoaForm, PoaAuditLog, PoaLineItem } from "@prisma/client";

// Mutable copies so write ops work within a dev session
const users: User[] = [...MOCK_USERS];
const poas: PoaForm[] = [...MOCK_POAS];
const auditLogs: PoaAuditLog[] = [...MOCK_AUDIT_LOGS];
const lineItems: PoaLineItem[] = [...MOCK_LINE_ITEMS];

// ─── Relation resolver ───────────────────────────────────────────────────────

// Prisma include values can be `true` (include with no nested includes) or an object
// (include with nested includes). Normalise to an object or null before recursing.
function nestedInclude(val: unknown): Record<string, unknown> | undefined {
  if (!val) return undefined;
  if (typeof val === "object") return val as Record<string, unknown>;
  return {}; // `true` → include the relation, no further nesting
}

function resolveIncludes<T>(record: T, include: Record<string, unknown> | undefined): T {
  if (!include || typeof include !== "object") return record;

  // Prisma wraps relation options as { include: { ... }, orderBy: ... }.
  // Unwrap one level so relation keys are always at the top of the object we check.
  const eff: Record<string, unknown> =
    typeof include.include === "object" && include.include !== null
      ? (include.include as Record<string, unknown>)
      : include;

  const result: Record<string, unknown> = { ...(record as Record<string, unknown>) };

  if ("owner" in eff && "ownerId" in result) {
    const owner = users.find((u) => u.nip === result.ownerId) ?? null;
    result.owner = owner ? resolveIncludes(owner, nestedInclude(eff.owner)) : null;
  }
  if ("currentHolder" in eff && "currentHolderId" in result) {
    result.currentHolder = users.find((u) => u.nip === result.currentHolderId) ?? null;
  }
  if ("reportsTo" in eff && "nipAtasan" in result) {
    const manager = users.find((u) => u.nip === result.nipAtasan) ?? null;
    result.reportsTo = manager ? resolveIncludes(manager, nestedInclude(eff.reportsTo)) : null;
  }
  if ("subordinates" in eff && "nip" in result) {
    result.subordinates = users.filter((u) => u.nipAtasan === result.nip);
  }
  if ("auditLogs" in eff && "id" in result) {
    const poaId = result.id as string;
    const logsForPoa = auditLogs
      .filter((l) => l.poaId === poaId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // auditLogs include may itself carry { include: { actor: true }, orderBy: ... }
    const logOpts = nestedInclude(eff.auditLogs);
    const logInclude =
      logOpts && typeof logOpts.include === "object"
        ? (logOpts.include as Record<string, unknown>)
        : logOpts;
    if (logInclude && "actor" in logInclude) {
      result.auditLogs = logsForPoa.map((l) => ({
        ...l,
        actor: users.find((u) => u.nip === l.actorId) ?? null,
      }));
    } else {
      result.auditLogs = logsForPoa;
    }
  }
  if ("items" in eff && "id" in result) {
    const poaId = result.id as string;
    result.items = lineItems.filter((li) => li.poaId === poaId);
  }
  if ("actor" in eff && "actorId" in result) {
    result.actor = users.find((u) => u.nip === result.actorId) ?? null;
  }

  return result as T;
}

// ─── Filter helpers ──────────────────────────────────────────────────────────

function matchesWhere<T extends object>(record: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (record as Record<string, unknown>)[key];

    if (condition === null || condition === undefined) {
      if (value !== null && value !== undefined) return false;
      continue;
    }

    if (typeof condition === "object" && condition !== null) {
      const cond = condition as Record<string, unknown>;

      if ("in" in cond) {
        if (!(cond.in as unknown[]).includes(value)) return false;
        continue;
      }
      if ("notIn" in cond) {
        if ((cond.notIn as unknown[]).includes(value)) return false;
        continue;
      }
      if ("not" in cond) {
        if (value === cond.not) return false;
        continue;
      }
      // Nested object match (e.g. status: { in: [...] })
      if (!matchesWhere({ value } as Record<string, unknown>, { value: condition })) return false;
      continue;
    }

    if (value !== condition) return false;
  }
  return true;
}

// ─── Mock User Model ─────────────────────────────────────────────────────────

const userModel = {
  async findUnique({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
    const found = users.find((u) => matchesWhere(u, where)) ?? null;
    return found ? resolveIncludes(found, include) : null;
  },

  async findUniqueOrThrow({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
    const found = users.find((u) => matchesWhere(u, where));
    if (!found) throw new Error(`Mock: User not found with ${JSON.stringify(where)}`);
    return resolveIncludes(found, include);
  },

  async findMany({ where, include, select }: { where?: Record<string, unknown>; include?: Record<string, unknown>; select?: Record<string, unknown> } = {}) {
    const filtered = where ? users.filter((u) => matchesWhere(u, where)) : [...users];
    if (select) {
      return filtered.map((u) => {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(select)) result[key] = (u as Record<string, unknown>)[key];
        return result;
      });
    }
    return filtered.map((u) => resolveIncludes(u, include));
  },

  async update({ where, data }: { where: Record<string, unknown>; data: Partial<User> }) {
    const idx = users.findIndex((u) => matchesWhere(u, where));
    if (idx === -1) throw new Error(`Mock: User not found for update`);
    users[idx] = { ...users[idx], ...data, updatedAt: new Date() };
    return users[idx];
  },

  async upsert({ where, create, update }: { where: Record<string, unknown>; create: User; update: Partial<User> }) {
    const idx = users.findIndex((u) => matchesWhere(u, where));
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...update, updatedAt: new Date() };
      return users[idx];
    }
    const newUser: User = { ...(create as User) };
    users.push(newUser);
    return newUser;
  },

  async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<User> }) {
    let count = 0;
    users.forEach((u, i) => {
      if (matchesWhere(u, where)) {
        users[i] = { ...u, ...data };
        count++;
      }
    });
    return { count };
  },
};

// ─── Mock PoaForm Model ──────────────────────────────────────────────────────

const poaFormModel = {
  async findMany({
    where,
    include,
    orderBy,
    take,
  }: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
    orderBy?: Record<string, string> | Record<string, string>[];
    take?: number;
  } = {}) {
    let filtered = where ? poas.filter((p) => matchesWhere(p, where)) : [...poas];

    if (orderBy) {
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      filtered.sort((a, b) => {
        for (const ord of orders) {
          const [field, dir] = Object.entries(ord)[0];
          const av = (a as Record<string, unknown>)[field];
          const bv = (b as Record<string, unknown>)[field];
          const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
          if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }

    if (take) filtered = filtered.slice(0, take);
    return filtered.map((p) => resolveIncludes(p, include));
  },

  async findUnique({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
    const found = poas.find((p) => matchesWhere(p, where)) ?? null;
    return found ? resolveIncludes(found, include) : null;
  },

  async findUniqueOrThrow({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
    const found = poas.find((p) => matchesWhere(p, where));
    if (!found) throw new Error(`Mock: PoaForm not found with ${JSON.stringify(where)}`);
    return resolveIncludes(found, include);
  },

  async create({ data }: { data: Omit<PoaForm, "id" | "createdAt" | "updatedAt"> & { id?: string } }) {
    const now = new Date();
    const poa: PoaForm = {
      ...(data as PoaForm),
      id: data.id ?? `poa-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    poas.push(poa);
    return poa;
  },

  async update({ where, data }: { where: Record<string, unknown>; data: Partial<PoaForm> }) {
    const idx = poas.findIndex((p) => matchesWhere(p, where));
    if (idx === -1) throw new Error(`Mock: PoaForm not found for update`);
    poas[idx] = { ...poas[idx], ...data, updatedAt: new Date() };
    return poas[idx];
  },
};

// ─── Mock PoaAuditLog Model ──────────────────────────────────────────────────

const poaAuditLogModel = {
  async findMany({
    where,
    include,
    orderBy,
  }: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
    orderBy?: Record<string, string>;
  } = {}) {
    let filtered = where ? auditLogs.filter((l) => matchesWhere(l, where)) : [...auditLogs];
    if (orderBy) {
      const [field, dir] = Object.entries(orderBy)[0];
      filtered.sort((a, b) => {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return filtered.map((l) => resolveIncludes(l, include));
  },

  async create({ data }: { data: Omit<PoaAuditLog, "id" | "createdAt"> & { id?: string } }) {
    const log: PoaAuditLog = {
      ...(data as PoaAuditLog),
      id: data.id ?? `log-${Date.now()}`,
      createdAt: new Date(),
    };
    auditLogs.push(log);
    return log;
  },
};

// ─── Mock PoaLineItem Model ──────────────────────────────────────────────────

const poaLineItemModel = {
  async findMany({
    where,
    orderBy,
  }: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, string> | Record<string, string>[];
  } = {}) {
    let filtered = where ? lineItems.filter((li) => matchesWhere(li, where)) : [...lineItems];
    if (orderBy) {
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      filtered.sort((a, b) => {
        for (const ord of orders) {
          const [field, dir] = Object.entries(ord)[0];
          const av = (a as Record<string, unknown>)[field];
          const bv = (b as Record<string, unknown>)[field];
          const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
          if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    return filtered;
  },

  async findUnique({ where }: { where: Record<string, unknown> }) {
    return lineItems.find((li) => matchesWhere(li, where)) ?? null;
  },

  async create({ data }: { data: Omit<PoaLineItem, "id" | "createdAt" | "updatedAt"> & { id?: string } }) {
    const now = new Date();
    const item: PoaLineItem = {
      ...(data as PoaLineItem),
      id: data.id ?? `li-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    lineItems.push(item);
    return item;
  },

  async update({ where, data }: { where: Record<string, unknown>; data: Partial<PoaLineItem> }) {
    const idx = lineItems.findIndex((li) => matchesWhere(li, where));
    if (idx === -1) throw new Error(`Mock: PoaLineItem not found for update`);
    lineItems[idx] = { ...lineItems[idx], ...data, updatedAt: new Date() };
    return lineItems[idx];
  },

  async delete({ where }: { where: Record<string, unknown> }) {
    const idx = lineItems.findIndex((li) => matchesWhere(li, where));
    if (idx === -1) throw new Error(`Mock: PoaLineItem not found for delete`);
    const [deleted] = lineItems.splice(idx, 1);
    return deleted;
  },

  async deleteMany({ where }: { where: Record<string, unknown> }) {
    const before = lineItems.length;
    const remaining = lineItems.filter((li) => !matchesWhere(li, where));
    lineItems.length = 0;
    lineItems.push(...remaining);
    return { count: before - lineItems.length };
  },
};

// ─── $transaction ────────────────────────────────────────────────────────────

async function transaction<T>(operations: Promise<T>[]): Promise<T[]> {
  return Promise.all(operations);
}

// ─── Mock Outlet + MrOutletAssignment (stubs — mock mode uses masterData.ts) ──

const outletModel = {
  async findMany() { return []; },
  async findUnique() { return null; },
  async upsert({ create }: { create: unknown }) { return create; },
};

const mrOutletAssignmentModel = {
  async findMany() { return []; },
  async deleteMany() { return { count: 0 }; },
  async create({ data }: { data: unknown }) { return data; },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const mockPrismaClient = {
  user: userModel,
  poaForm: poaFormModel,
  poaAuditLog: poaAuditLogModel,
  poaLineItem: poaLineItemModel,
  outlet: outletModel,
  mrOutletAssignment: mrOutletAssignmentModel,
  $transaction: transaction,
  $disconnect: async () => {},
};
