import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DefinisiContent } from "./DefinisiContent";

export const metadata = { title: "Definisi · Form POA" };

export default async function DefinisiPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  return <DefinisiContent />;
}
