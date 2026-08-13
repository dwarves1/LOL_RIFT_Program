import { signOutResponse } from "../../../../lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return signOutResponse(request);
}
