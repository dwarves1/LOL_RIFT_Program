/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RESULT_IMAGES: R2Bucket;
    ASSETS: Fetcher;
    OWNER_EMAIL?: string;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    AUTH_SESSION_SECRET?: string;
  }
}
