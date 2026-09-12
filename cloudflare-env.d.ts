// Import only binding types; Worker globals conflict with the native Node runtime.
declare namespace Cloudflare {
  interface Env {
    DB?: import("@cloudflare/workers-types/index.ts").D1Database;
    BUCKET?: import("@cloudflare/workers-types/index.ts").R2Bucket;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
