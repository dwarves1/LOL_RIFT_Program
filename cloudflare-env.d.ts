/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RESULT_IMAGES: R2Bucket;
    ASSETS: Fetcher;
    OWNER_EMAIL?: string;
  }
}
