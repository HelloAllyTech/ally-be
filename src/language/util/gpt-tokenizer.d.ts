/**
 * gpt-tokenizer v3 ships its types behind a package `exports` map that the
 * repo's legacy `moduleResolution` (node10, implied by `module: commonjs`)
 * cannot see. Runtime resolution works — Node's require honors the exports
 * map — so this declaration only fills the type gap for the one subpath we
 * use. Remove when tsconfig moves to node16/bundler resolution.
 */
declare module 'gpt-tokenizer/encoding/o200k_base' {
  export function countTokens(text: string): number;
  export function encode(text: string): number[];
  export function decode(tokens: number[]): string;
}
