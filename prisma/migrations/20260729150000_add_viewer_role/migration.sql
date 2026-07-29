-- New "VIEWER" role — same read-only company-wide oversight as GM (every
-- POA + full Summary, no edit/approve/create rights), kept distinct from
-- GM so it isn't conflated with the real General Manager title.
ALTER TYPE "Role" ADD VALUE 'VIEWER';
