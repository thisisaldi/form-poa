import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export interface OmegaEmployeeZone {
  code: string;
  name: string;
  type: string;
  project: string;
}

export interface OmegaEmployee {
  nip: string;
  nama: string;
  position: string;
  zones?: OmegaEmployeeZone[];
}

export interface OmegaSubordinate {
  nip: string;
  nama: string;
  project: string;
  position: string;
}

export interface OmegaSyncResult {
  upserted: number;
  hierarchyUpdated: number;
  deactivated: number;
  errors: string[];
}

function mapPositionToRoleAndJabatan(position: string): { role: Role; jabatan: string | null } {
  const normalized = position.trim();
  switch (normalized) {
    case "National Sales Manager":
      return { role: "NSM", jabatan: "NSM" };
    case "Sales Manager":
      return { role: "SM", jabatan: "SM" };
    case "Area Sales Manager":
      return { role: "ASM", jabatan: "ASM" };
    case "Supervisor":
      return { role: "MR", jabatan: "SPV" };
    case "Field Force":
    default:
      return { role: "MR", jabatan: "Field Force" };
  }
}

/**
 * Sync Users for Project 'omega' from Nexus API endpoints:
 * 1. GET /api/r/poa/get_employees?project=omega
 * 2. GET /api/r/poa/get_subordinates?nip=<NIP>
 */
export async function runOmegaUserSync(): Promise<OmegaSyncResult> {
  const auth = Buffer.from("poa_exodus:poA_3x0dus").toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
  };

  const errors: string[] = [];
  let upserted = 0;
  let hierarchyUpdated = 0;
  const now = new Date();

  // 1. Fetch Employees
  console.log("Fetching employees for project=omega from Nexus API...");
  const empRes = await fetch("https://api-nexus.pharos.id/api/r/poa/get_employees?project=omega", { headers });
  if (!empRes.ok) {
    throw new Error(`Failed to fetch employees: ${empRes.status} ${await empRes.text()}`);
  }

  const empJson = await empRes.json();
  const employees: OmegaEmployee[] = empJson.data?.employees || [];
  console.log(`Retrieved ${employees.length} employees for project omega.`);

  // 2. Upsert Employees to User table
  for (const emp of employees) {
    if (!emp.nip) continue;
    try {
      const { role, jabatan } = mapPositionToRoleAndJabatan(emp.position || "");
      const territoryZone = emp.zones?.find((z) => z.type === "territory") || emp.zones?.[0];

      await prisma.user.upsert({
        where: { nip: emp.nip },
        create: {
          nip: emp.nip,
          name: emp.nama.trim(),
          role,
          jabatan,
          project: "OMEGA",
          kodeWilayah: territoryZone?.code || null,
          namaWilayah: territoryZone?.name || null,
          isActive: true,
          syncedAt: now,
        },
        update: {
          name: emp.nama.trim(),
          role,
          jabatan,
          project: "OMEGA",
          kodeWilayah: territoryZone?.code || null,
          namaWilayah: territoryZone?.name || null,
          isActive: true,
          syncedAt: now,
        },
      });
      upserted++;
    } catch (err: any) {
      errors.push(`Upsert NIP ${emp.nip} error: ${err.message || String(err)}`);
    }
  }

  // 3. Hierarchy Sync via get_subordinates for Managers
  // Strictly sequential by tier: NSM -> SM -> ASM.
  // We MUST wait for each tier to complete fully before running the next tier.
  // Otherwise, if an SM and an ASM run concurrently in the same batch, the SM's
  // downstream update can overwrite the ASM's direct subordinates (race condition).
  const nsms = employees.filter((e) => e.position === "National Sales Manager");
  const sms = employees.filter((e) => e.position === "Sales Manager");
  const asms = employees.filter((e) => e.position === "Area Sales Manager");

  async function syncTier(managers: OmegaEmployee[], tierName: string) {
    if (managers.length === 0) return;
    console.log(`Syncing hierarchy for ${managers.length} ${tierName}...`);
    const batchSize = 10;
    for (let i = 0; i < managers.length; i += batchSize) {
      const batch = managers.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (mgr) => {
          try {
            const subRes = await fetch(`https://api-nexus.pharos.id/api/r/poa/get_subordinates?nip=${mgr.nip}`, { headers });
            if (!subRes.ok) return;

            const subJson = await subRes.json();
            const subs: OmegaSubordinate[] = subJson.data?.subordinates || [];

            for (const sub of subs) {
              if (!sub.nip) continue;

              await prisma.user.updateMany({
                where: { nip: sub.nip },
                data: {
                  nipAtasan: mgr.nip,
                  namaAtasan: mgr.nama.trim(),
                },
              });
              hierarchyUpdated++;
            }
          } catch (err: any) {
            errors.push(`Subordinates fetch for manager NIP ${mgr.nip} error: ${err.message || String(err)}`);
          }
        })
      );
    }
  }

  // Strictly sequential execution:
  // 1. NSM first (sets downline to NSM)
  // 2. SM second (overrides downline under that SM to SM)
  // 3. ASM last (overrides direct MRs under that ASM to ASM)
  await syncTier(nsms, "NSM");
  await syncTier(sms, "SM");
  await syncTier(asms, "ASM");


  // 4. Deactivate omega users no longer in the employee list
  const activeNips = employees.map((e) => e.nip);
  const deactivated = await prisma.user.updateMany({
    where: {
      project: "omega",
      nip: { notIn: activeNips },
      isActive: true,
    },
    data: { isActive: false },
  });

  return {
    upserted,
    hierarchyUpdated,
    deactivated: deactivated.count,
    errors,
  };
}
