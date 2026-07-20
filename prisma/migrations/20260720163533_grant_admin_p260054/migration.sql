-- Data migration: grant ADMIN role to NIP P260054 (requested by the account owner
-- directly, since the app's own login has no separate admin-provisioning step).
-- No-op / safe to rerun if the NIP doesn't exist yet or is already ADMIN.
UPDATE "User" SET role = 'ADMIN' WHERE nip = 'P260054';
