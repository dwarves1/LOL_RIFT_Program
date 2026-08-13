import { env } from "cloudflare:workers";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_STATE_COOKIE = "lolrift_google_state";
const APP_SESSION_COOKIE = "lolrift_session";
const GOOGLE_PROVIDER = "google";
const textEncoder = new TextEncoder();

type GoogleConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
};

type OAuthState = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
};

type AppSession = { userId: string; expiresAt: number };

type GoogleTokenClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

export type GoogleIdentity = {
  provider: typeof GOOGLE_PROVIDER;
  subject: string;
  email: string;
  displayName: string;
};

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  return normalized;
}

function getConfig(): GoogleConfiguration {
  return {
    clientId: requiredValue(env.GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredValue(env.GOOGLE_OAUTH_CLIENT_SECRET, "GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requiredValue(env.GOOGLE_OAUTH_REDIRECT_URI, "GOOGLE_OAUTH_REDIRECT_URI"),
    sessionSecret: requiredValue(env.AUTH_SESSION_SECRET, "AUTH_SESSION_SECRET"),
  };
}

function getSessionSecret() {
  return env.AUTH_SESSION_SECRET?.trim() || null;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))));
}

function equalValues(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function signPayload(payload: unknown, secret: string) {
  const encoded = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await sign(encoded, secret)}`;
}

async function readPayload<T>(value: string | null, secret: string): Promise<T | null> {
  if (!value) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || !equalValues(signature, await sign(encoded, secret))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as T;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const prefix = `${name}=`;
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const value = item.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number, path: string, secure = true) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://lolrift.local");
    return url.origin === "https://lolrift.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

async function sha256Base64Url(value: string) {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))));
}

function readIdTokenPayload(value: string): GoogleTokenClaims {
  const [, payload, signature] = value.split(".");
  if (!payload || !signature) throw new Error("Google ID 토큰 형식이 올바르지 않습니다.");
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as GoogleTokenClaims;
  } catch {
    throw new Error("Google ID 토큰을 읽을 수 없습니다.");
  }
}

function requireString(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`Google ${label} 정보를 확인할 수 없습니다.`);
  return normalized;
}

export function googleSignInPath(returnTo: string) {
  return `/api/auth/google/start?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function googleSignOutPath(returnTo = "/") {
  return `/api/auth/logout?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export async function startGoogleLogin(request: Request) {
  const config = getConfig();
  const state: OAuthState = {
    state: randomValue(),
    nonce: randomValue(),
    verifier: randomValue(),
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("return_to")),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    code_challenge: await sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const response = Response.redirect(authorizationUrl, 302);
  response.headers.append("set-cookie", cookie(GOOGLE_STATE_COOKIE, await signPayload(state, config.sessionSecret), 600, "/api/auth/google"));
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function completeGoogleLogin(request: Request): Promise<{ identity: GoogleIdentity; returnTo: string; sessionCookie: string; clearStateCookie: string }> {
  const config = getConfig();
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) throw new Error(`Google 로그인이 취소되었거나 거부되었습니다. (${providerError})`);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthState = await readPayload<OAuthState>(cookieValue(request, GOOGLE_STATE_COOKIE), config.sessionSecret);
  if (!code || !returnedState || !oauthState || oauthState.expiresAt < Date.now() || !equalValues(returnedState, oauthState.state)) {
    throw new Error("Google 로그인 요청을 확인할 수 없습니다. 다시 시도해 주세요.");
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: oauthState.verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error("Google 인증 코드를 교환하지 못했습니다. 다시 로그인해 주세요.");
  const tokenPayload = await tokenResponse.json() as { id_token?: unknown };
  const claims = readIdTokenPayload(requireString(tokenPayload.id_token, "ID 토큰"));
  const issuer = requireString(claims.iss, "발급자");
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") throw new Error("신뢰할 수 없는 Google ID 토큰입니다.");
  if (claims.aud !== config.clientId || Number(claims.exp) * 1000 <= Date.now() || claims.nonce !== oauthState.nonce) {
    throw new Error("Google ID 토큰 검증에 실패했습니다.");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("인증된 Google 이메일 계정으로 로그인해 주세요.");

  const email = requireString(claims.email, "이메일").toLocaleLowerCase("en-US");
  const displayName = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email.split("@")[0];
  const userId = await resolveGoogleIdentity({ provider: GOOGLE_PROVIDER, subject: requireString(claims.sub, "계정 식별자"), email, displayName });
  return {
    identity: { provider: GOOGLE_PROVIDER, subject: requireString(claims.sub, "계정 식별자"), email, displayName },
    returnTo: oauthState.returnTo,
    sessionCookie: cookie(APP_SESSION_COOKIE, await signPayload({ userId, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 } satisfies AppSession, config.sessionSecret), 30 * 24 * 60 * 60, "/"),
    clearStateCookie: cookie(GOOGLE_STATE_COOKIE, "", 0, "/api/auth/google"),
  };
}

// Imported lazily to keep the low-level OAuth helpers independent from the
// database initialization path used by build-time rendering.
async function resolveGoogleIdentity(identity: GoogleIdentity) {
  const { resolveGoogleIdentityToUserId } = await import("./tournament-service");
  return resolveGoogleIdentityToUserId(identity);
}

export async function currentSessionUserId(request: Request) {
  const secret = getSessionSecret();
  if (!secret) return null;
  const session = await readPayload<AppSession>(cookieValue(request, APP_SESSION_COOKIE), secret);
  return session && session.expiresAt > Date.now() && session.userId ? session.userId : null;
}

export function signOutResponse(request: Request) {
  const response = Response.redirect(new URL(safeReturnTo(new URL(request.url).searchParams.get("return_to")), request.url), 302);
  response.headers.append("set-cookie", cookie(APP_SESSION_COOKIE, "", 0, "/"));
  response.headers.set("cache-control", "no-store");
  return response;
}
