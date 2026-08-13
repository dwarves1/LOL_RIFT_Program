import { completeGoogleLogin } from "../../../../../lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await completeGoogleLogin(request);
    const response = Response.redirect(new URL(result.returnTo, request.url), 302);
    response.headers.append("set-cookie", result.sessionCookie);
    response.headers.append("set-cookie", result.clearStateCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    const response = Response.redirect(new URL("/?auth_error=google_login_failed", request.url), 302);
    response.headers.append("set-cookie", "lolrift_google_state=; Path=/api/auth/google; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
