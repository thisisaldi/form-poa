import { redirect } from "next/navigation";

// Root redirects to dashboard (auth guard handles the /login redirect)
export default function RootPage() {
  redirect("/dashboard");
}
