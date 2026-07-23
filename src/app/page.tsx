import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { postLoginPath } from "@/lib/types";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(postLoginPath(user));
}
