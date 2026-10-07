import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/masterData";
import { getHkaGroupsAction } from "@/app/actions/poaStandarisasiPusat";
import { PusatCreateForm } from "@/components/poaStandarisasi/PusatCreateForm";

export default async function PusatNewPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const actor = await prisma.user.findUnique({ where: { nip: session.userId }, select: { isHka: true, role: true } });
  if (!actor || !(actor.isHka || actor.role === "ADMIN")) notFound();

  const [groups, products] = await Promise.all([getHkaGroupsAction(), getProducts()]);
  return <PusatCreateForm groups={groups} productOptions={products.map((p) => ({ kodeProduk: p.kodeProduk, namaProduk: p.namaProduk }))} />;
}
