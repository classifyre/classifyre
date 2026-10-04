declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.css";

/** Webpack's directory import, used to discover `videos/` without listing it. */
interface WebpackRequireContext {
  keys(): string[];
  <T>(id: string): T;
}

declare namespace NodeJS {
  interface Require {
    context(
      directory: string,
      useSubdirectories: boolean,
      regExp: RegExp,
    ): WebpackRequireContext;
  }
}
