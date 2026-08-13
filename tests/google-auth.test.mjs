import assert from "node:assert/strict";
import test from "node:test";
import { redirectWithCookies } from "../lib/google-auth.ts";

test("OAuth redirects allow state and session cookies to be attached", () => {
  const response = redirectWithCookies("https://accounts.google.com/o/oauth2/v2/auth?state=test", [
    "oauth_state=signed; Path=/api/auth/google; HttpOnly; Secure",
    "session=signed; Path=/; HttpOnly; Secure",
  ]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?state=test");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie"), /oauth_state=signed/);
  assert.match(response.headers.get("set-cookie"), /session=signed/);
});
