/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_API?: string;
  readonly VITE_CLIENT_SYNC?: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
