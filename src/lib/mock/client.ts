/**
 * Mock Prisma client for local dev (USE_MOCK_DB=true).
 * Implements the subset of Prisma's API used by this app using in-memory arrays.
 * Write operations mutate the in-memory arrays for the session lifetime.
 */

import fs from "fs";
import path from "path";
import {
  MOCK_USERS, MOCK_POAS, MOCK_AUDIT_LOGS, MOCK_LINE_ITEMS,
  MOCK_OUTLETS, MOCK_CUSTOMER_RECORDS, MOCK_CUSTOMER_OUTLETS, MOCK_MR_ASSIGNMENTS,
} from "./data";
import type { User, PoaForm, PoaAuditLog, PoaLineItem } from "@prisma/client";
import type { MockOutlet, MockCustomerRecord, MockCustomerOutlet, MockMrAssignment } from "./data";

// Load generated data from Excel if available, fall back to hardcoded data.
// generated-data.json is gitignored (dev-local, produced by scripts/*) and
// often absent — read it via fs at runtime (not require()) so bundlers don't
// try to statically resolve it as a module and fail the build when missing.
function loadGenerated<T>(key: string, fallback: T[]): T[] {
  try {
    const filePath = path.join(process.cwd(), "src/lib/mock/generated-data.json");
    const gen = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return (gen[key] as T[]) ?? fallback;
  } catch {
    return fallback;
  }
}

// Mutable copies so write ops work within a dev session
const users: User[] = loadGenerated<User>("users", MOCK_USERS);
const poas: PoaForm[] = [...MOCK_POAS];
const auditLogs: PoaAuditLog[] = [...MOCK_AUDIT_LOGS];
const lineItems: PoaLineItem[] = [...MOCK_LINE_ITEMS];
const outlets: MockOutlet[] = loadGenerated("outlets", MOCK_OUTLETS);
const customers: MockCustomerRecord[] = loadGenerated("customers", MOCK_CUSTOMER_RECORDS);
const customerOutlets: MockCustomerOutlet[] = loadGenerated("customerOutlets", MOCK_CUSTOMER_OUTLETS);
const mrAssignments: MockMrAssignment[] = loadGenerated("mrAssignments", MOCK_MR_ASSIGNMENTS);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchesWhere<T extends object>(record: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (record as Record<string, unknown>)[key];
    if (condition === null || condition === undefined) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (typeof condition === "object" && condition !== null) {
      const cond = condition as Record<string, unknown>;
      if ("in" in cond) { if (!(cond.in as unknown[]).includes(value)) return false; continue; }
      if ("notIn" in cond) { if ((cond.notIn as unknown[]).includes(value)) return false; continue; }
      if ("not" in cond) { if (value === cond.not) return false; continue; }
      if ("equals" in cond && cond.mode === "insensitive") {
        if (typeof value !== "string" || typeof cond.equals !== "string" || value.toLowerCase() !== cond.equals.toLowerCase()) return false;
        continue;
      }
      if (!matchesWhere({ value } as Record<string, unknown>, { value: condition })) return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

function applyOrderBy<T>(arr: T[], orderBy?: Record<string, string> | Record<string, string>[]): T[] {
  if (!orderBy) return arr;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...arr].sort((a, b) => {
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

function pickSelect<T>(record: T, select: Record<string, unknown>): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    result[key] = (record as Record<string, unknown>)[key];
  }
  return result as Partial<T>;
}

// ─── Relation resolver ───────────────────────────────────────────────────────

function nestedInclude(val: unknown): Record<string, unknown> | undefined {
  if (!val) return undefined;
  if (typeof val === "object") return val as Record<string, unknown>;
  return {};
}

function resolveIncludes<T>(record: T, include: Record<string, unknown> | undefined): T {
  if (!include || typeof include !== "object") return record;

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
    result.items = lineItems.filter((li) => li.poaId === result.id);
  }
  if ("actor" in eff && "actorId" in result) {
    result.actor = users.find((u) => u.nip === result.actorId) ?? null;
  }
  if ("customer" in eff && "customerId" in result) {
    const cust = customers.find((c) => c.id === result.customerId) ?? null;
    if (cust && typeof eff.customer === "object" && eff.customer !== null) {
      const custOpts = eff.customer as Record<string, unknown>;
      if (custOpts.select) {
        result.customer = pickSelect(cust, custOpts.select as Record<string, unknown>);
      } else {
        result.customer = cust;
      }
    } else {
      result.customer = cust;
    }
  }

  return result as T;
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
    if (select) return filtered.map((u) => pickSelect(u, select));
    return filtered.map((u) => resolveIncludes(u, include));
  },
  async findFirst({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> } = {}) {
    const found = (where ? users.find((u) => matchesWhere(u, where)) : users[0]) ?? null;
    return found ? resolveIncludes(found, include) : null;
  },
  async update({ where, data }: { where: Record<string, unknown>; data: Partial<User> }) {
    const idx = users.findIndex((u) => matchesWhere(u, where));
    if (idx === -1) throw new Error(`Mock: User not found for update`);
    users[idx] = { ...users[idx], ...data, updatedAt: new Date() };
    return users[idx];
  },
  async upsert({ where, create, update }: { where: Record<string, unknown>; create: User; update: Partial<User> }) {
    const idx = users.findIndex((u) => matchesWhere(u, where));
    if (idx !== -1) { users[idx] = { ...users[idx], ...update, updatedAt: new Date() }; return users[idx]; }
    const newUser: User = { ...(create as User) };
    users.push(newUser);
    return newUser;
  },
  async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<User> }) {
    let count = 0;
    users.forEach((u, i) => { if (matchesWhere(u, where)) { users[i] = { ...u, ...data }; count++; } });
    return { count };
  },
  async count({ where }: { where?: Record<string, unknown> } = {}) {
    return where ? users.filter((u) => matchesWhere(u, where)).length : users.length;
  },
};

// ─── Mock PoaForm Model ──────────────────────────────────────────────────────

const poaFormModel = {
  async findMany({ where, include, orderBy, take }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, string> | Record<string, string>[]; take?: number } = {}) {
    let filtered = where ? poas.filter((p) => matchesWhere(p, where)) : [...poas];
    filtered = applyOrderBy(filtered, orderBy);
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
    const poa: PoaForm = { ...(data as PoaForm), id: data.id ?? `poa-${Date.now()}`, createdAt: now, updatedAt: now };
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
  async findMany({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, string> } = {}) {
    let filtered = where ? auditLogs.filter((l) => matchesWhere(l, where)) : [...auditLogs];
    filtered = applyOrderBy(filtered, orderBy);
    return filtered.map((l) => resolveIncludes(l, include));
  },
  async create({ data }: { data: Omit<PoaAuditLog, "id" | "createdAt"> & { id?: string } }) {
    const log: PoaAuditLog = { ...(data as PoaAuditLog), id: data.id ?? `log-${Date.now()}`, createdAt: new Date() };
    auditLogs.push(log);
    return log;
  },
};

// ─── Mock PoaLineItem Model ──────────────────────────────────────────────────

const poaLineItemModel = {
  async findMany({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, string> | Record<string, string>[] } = {}) {
    const filtered = where ? lineItems.filter((li) => matchesWhere(li, where)) : [...lineItems];
    return applyOrderBy(filtered, orderBy);
  },
  async findUnique({ where }: { where: Record<string, unknown> }) {
    return lineItems.find((li) => matchesWhere(li, where)) ?? null;
  },
  async create({ data }: { data: Omit<PoaLineItem, "id" | "createdAt" | "updatedAt"> & { id?: string } }) {
    const now = new Date();
    const item: PoaLineItem = { ...(data as PoaLineItem), id: data.id ?? `li-${Date.now()}`, createdAt: now, updatedAt: now };
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

// ─── Mock Outlet Model ────────────────────────────────────────────────────────

const outletModel = {
  async findMany({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) {
    const filtered = where ? outlets.filter((o) => matchesWhere(o, where)) : [...outlets];
    if (select) return filtered.map((o) => pickSelect(o, select));
    return filtered;
  },
  async findUnique({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) {
    const found = outlets.find((o) => matchesWhere(o, where)) ?? null;
    if (!found) return null;
    if (select) return pickSelect(found, select);
    return found;
  },
  async upsert({ where, create }: { where: Record<string, unknown>; create: unknown; update: unknown }) {
    const idx = outlets.findIndex((o) => matchesWhere(o, where));
    if (idx !== -1) return outlets[idx];
    const newOutlet = create as MockOutlet;
    outlets.push(newOutlet);
    return newOutlet;
  },
};

// ─── Mock Customer Model ──────────────────────────────────────────────────────

const customerModel = {
  async findUnique({ where }: { where: Record<string, unknown> }) {
    return customers.find((c) => matchesWhere(c, where)) ?? null;
  },
  async findMany({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) {
    const filtered = where ? customers.filter((c) => matchesWhere(c, where)) : [...customers];
    if (select) return filtered.map((c) => pickSelect(c, select));
    return filtered;
  },
  async create({ data }: { data: Partial<MockCustomerRecord> }) {
    const now = new Date();
    const c: MockCustomerRecord = {
      id: `cust-${Date.now()}`,
      kodeCustomer: null,
      namaCustomer: "",
      spesialisasi: "",
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    customers.push(c);
    return c;
  },
  async upsert({ where, create, update }: { where: Record<string, unknown>; create: Partial<MockCustomerRecord>; update: Partial<MockCustomerRecord> }) {
    const idx = customers.findIndex((c) => matchesWhere(c, where));
    if (idx !== -1) { customers[idx] = { ...customers[idx], ...update, updatedAt: new Date() }; return customers[idx]; }
    return customerModel.create({ data: create });
  },
};

// ─── Mock CustomerOutlet Model ────────────────────────────────────────────────

const customerOutletModel = {
  async findMany({
    where,
    include,
    select,
    orderBy,
    distinct,
  }: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: Record<string, string> | Record<string, string>[];
    distinct?: string[];
  } = {}) {
    let filtered = [...customerOutlets];

    // Handle where — including nested customer filter
    if (where) {
      const { customer: custFilter, ...directWhere } = where as { customer?: Record<string, unknown> } & Record<string, unknown>;
      if (Object.keys(directWhere).length) {
        filtered = filtered.filter((co) => matchesWhere(co, directWhere));
      }
      if (custFilter) {
        filtered = filtered.filter((co) => {
          const cust = customers.find((c) => c.id === co.customerId);
          return cust ? matchesWhere(cust, custFilter) : false;
        });
      }
    }

    // Distinct by field
    if (distinct) {
      const seen = new Set<string>();
      filtered = filtered.filter((co) => {
        const key = distinct.map((f) => String((co as unknown as Record<string, unknown>)[f])).join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Attach customer relation
    const withCustomer = filtered.map((co) => {
      const cust = customers.find((c) => c.id === co.customerId) ?? null;
      return { ...co, customer: cust };
    });

    // OrderBy (supports customer.namaCustomer via nested path)
    const sorted = applyOrderBy(withCustomer, orderBy);

    // Apply select or include
    if (select) {
      return sorted.map((co) => {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(select)) {
          if (key === "customer" && typeof val === "object" && val !== null) {
            const custSel = (val as Record<string, unknown>).select as Record<string, unknown> | undefined;
            result.customer = custSel ? pickSelect(co.customer ?? {}, custSel) : co.customer;
          } else if (key === "isFokus") {
            result.isFokus = co.isFokus;
          } else {
            result[key] = (co as unknown as Record<string, unknown>)[key];
          }
        }
        return result;
      });
    }

    return sorted.map((co) => resolveIncludes(co, include));
  },

  async findFirst({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) {
    const results = await customerOutletModel.findMany({ where, select });
    return results[0] ?? null;
  },

  async create({ data }: { data: Partial<MockCustomerOutlet> }) {
    const co: MockCustomerOutlet = {
      id: `co-${Date.now()}`,
      customerId: "",
      kodePI: "",
      isFokus: false,
      syncedAt: new Date(),
      ...data,
    };
    customerOutlets.push(co);
    return co;
  },

  async update({ where, data }: { where: Record<string, unknown>; data: Partial<MockCustomerOutlet> }) {
    const idx = customerOutlets.findIndex((co) => matchesWhere(co, where));
    if (idx === -1) throw new Error(`Mock: CustomerOutlet not found for update`);
    customerOutlets[idx] = { ...customerOutlets[idx], ...data };
    return customerOutlets[idx];
  },

  async upsert({ where, create, update }: { where: Record<string, unknown>; create: Partial<MockCustomerOutlet>; update: Partial<MockCustomerOutlet> }) {
    const idx = customerOutlets.findIndex((co) => matchesWhere(co, where));
    if (idx !== -1) { customerOutlets[idx] = { ...customerOutlets[idx], ...update }; return customerOutlets[idx]; }
    return customerOutletModel.create({ data: create });
  },

  async count({ where }: { where?: Record<string, unknown> } = {}) {
    const filtered = where ? customerOutlets.filter((co) => matchesWhere(co, where)) : customerOutlets;
    return filtered.length;
  },
};

// ─── Mock Product Model ───────────────────────────────────────────────────────

interface MockProduct {
  kodeProduk: string;
  namaGroupBrand: string;
  namaProduk: string;
  zatAktif: string | null;
  satuan: string;
  hna: string;
}

const products: MockProduct[] = loadGenerated("products", []);

const productModel = {
  async findMany({ orderBy }: { orderBy?: Record<string, string> } = {}) {
    return applyOrderBy([...products], orderBy);
  },
  async findUnique({ where }: { where: Record<string, unknown> }) {
    return products.find((p) => matchesWhere(p, where)) ?? null;
  },
};

// ─── Mock MrOutletAssignment Model ───────────────────────────────────────────

const mrOutletAssignmentModel = {
  async findMany({
    where,
    include,
    select,
  }: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
    select?: Record<string, unknown>;
  } = {}) {
    const filtered = where ? mrAssignments.filter((a) => matchesWhere(a, where)) : [...mrAssignments];

    return filtered.map((a) => {
      const outlet = outlets.find((o) => o.kodePI === a.kodePI) ?? null;
      const withOutlet = { ...a, outlet };
      if (select) return pickSelect(withOutlet, select);
      if (include) return resolveIncludes(withOutlet, include);
      return withOutlet;
    });
  },
  async deleteMany({ where }: { where: Record<string, unknown> }) {
    const before = mrAssignments.length;
    const remaining = mrAssignments.filter((a) => !matchesWhere(a, where));
    mrAssignments.length = 0;
    mrAssignments.push(...remaining);
    return { count: before - mrAssignments.length };
  },
  async create({ data }: { data: Partial<MockMrAssignment> }) {
    const a = { id: `asgn-${Date.now()}`, nipMR: "", kodePI: "", ...data } as MockMrAssignment;
    mrAssignments.push(a);
    return a;
  },
  async count({ where }: { where?: Record<string, unknown> } = {}) {
    return where ? mrAssignments.filter((a) => matchesWhere(a, where)).length : mrAssignments.length;
  },
};

// ─── $transaction ────────────────────────────────────────────────────────────

async function transaction<T>(operations: Promise<T>[]): Promise<T[]> {
  return Promise.all(operations);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const mockPrismaClient = {
  user: userModel,
  poaForm: poaFormModel,
  poaAuditLog: poaAuditLogModel,
  poaLineItem: poaLineItemModel,
  outlet: outletModel,
  product: productModel,
  customer: customerModel,
  customerOutlet: customerOutletModel,
  mrOutletAssignment: mrOutletAssignmentModel,
  $transaction: transaction,
  $disconnect: async () => {},
};
