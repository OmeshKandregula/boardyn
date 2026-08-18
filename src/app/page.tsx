import { redirect } from "next/navigation";
import { getWorkspacesForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** There is no marketing page on a self-hosted board. Go where the work is. */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspaces = await getWorkspacesForUser(user.id);
  if (workspaces.length === 0) redirect("/settings");

  redirect(`/w/${workspaces[0].slug}`);
}
