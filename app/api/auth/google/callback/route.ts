import { completeGoogleLogin, redirectWithCookies } from "../../../../../lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await completeGoogleLogin(request);
    return redirectWithCookies(new URL(result.returnTo, request.url), [result.sessionCookie, result.clearStateCookie]);
  } catch {
    return redirectWithCookies(new URL("/?auth_error=google_login_failed", request.url), [
      "lolrift_google_state=; Path=/api/auth/google; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    ]);
  }
}
