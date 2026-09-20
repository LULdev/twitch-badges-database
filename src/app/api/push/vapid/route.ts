import { envOrNull } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = envOrNull("VAPID_PUBLIC_KEY");
  if (!key) {
    return Response.json({ configured: false }, { status: 200 });
  }
  return Response.json({ configured: true, publicKey: key });
}
