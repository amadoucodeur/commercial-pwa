import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { LoginForm } from "../../components/login-form";

export default async function Connexion() {
  const session = await auth();
  if (session?.accessToken) redirect("/");
  return <LoginForm accessDenied={session?.accessDenied} />;
}
