import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { FaqContent } from "./FaqContent";

export const metadata = { title: "FAQ · Form POA" };

export default async function FaqPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  return <FaqContent />;
}
