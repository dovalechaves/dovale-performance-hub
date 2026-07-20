/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Ambiente do build do frontend. Vazio = produção; "homologacao" = HML. */
  readonly VITE_APP_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
