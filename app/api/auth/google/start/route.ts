import { startGoogleLogin } from "../../../../../lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await startGoogleLogin(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google 로그인 설정을 확인할 수 없습니다.";
    return new Response(message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
}
