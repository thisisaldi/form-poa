/**
 * `jabatan` is a display-only override of what's shown as a user's title
 * (currently only ever "SPV") — their `role`/permissions never change, see
 * scripts/importStrukturHospital.ts. Every UI spot that shows a role label
 * should go through this instead of reading `.role` directly.
 */
export function displayRole(role: string, jabatan?: string | null): string {
  return jabatan || role;
}
