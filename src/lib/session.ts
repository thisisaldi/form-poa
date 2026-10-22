import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { AsyncLocalStorage } from "node:async_hooks";

export interface SessionData {
  userId: string;
  nip: string;
  name: string;
  role: string;
  /** Display-only title override (e.g. "SPV") — see src/lib/role.ts displayRole(). */
  jabatan?: string | null;
  project?: string | null;
  isLoggedIn: boolean;
  isTestPsr?: boolean;
  originalRole?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: "poa_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days — long-lived, no secondary factor
    sameSite: "lax",
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

// Request-scoped viewer for external API calls (Exodus, HTTP Basic Auth) that
// carry no session cookie — set ONLY by server route code via runAsViewer
// (src/lib/kpiApiAuth.ts), so read actions reuse their own scope rules as-is.
// Not reachable from the client: there is no action/route that takes a viewer.
const apiViewer = new AsyncLocalStorage<SessionData>();

export function runAsViewer<T>(viewer: SessionData, fn: () => Promise<T>): Promise<T> {
  return apiViewer.run(viewer, fn);
}

export async function getCurrentUser(): Promise<SessionData | null> {
  const viewer = apiViewer.getStore();
  if (viewer) return viewer;
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}
