/**
 * Build-only shim for the balance types emit.
 *
 * `src/client/index.ts` imports `@dsh-plugins/client-ui-widget-manager/client`
 * as a type-only import to pull the `widgets.config` slot declaration onto the
 * slots SlotMap. tsconfig.build.json maps that specifier HERE instead of to the
 * other workspace package's sources (which would violate `rootDir` during
 * emit). Being a module (`export {}`), the `declare module` below is a proper
 * module AUGMENTATION of the real `@deepseek-ai/dsh-client-ui-slots` types —
 * the twin of the widget manager's own declaration, kept in sync manually.
 * Inert for consumers: the emitted declarations never reference the merge
 * (function bodies are erased), and `pnpm typecheck` still resolves the real
 * widget manager via tsconfig.json `paths`.
 */
export {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The widget manager's Configure-dialog slot (list, entry id = widget id). */
    'widgets.config': {
      kind: 'list'
      scope: 'root'
    }
  }
}
