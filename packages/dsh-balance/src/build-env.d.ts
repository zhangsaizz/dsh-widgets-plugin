/**
 * Build-only shim for the balance types emit.
 *
 * `src/client/index.ts` imports `@dsh-plugins/client-ui-widget-manager/client`
 * and `@dsh-plugins/client-ui-card-container/client` as type-only imports to
 * pull the `widgets.config` and `widgets.card` slot declarations onto the
 * slots SlotMap. tsconfig.build.json maps those specifiers HERE instead of to
 * the other workspace packages' sources (which would violate `rootDir` during
 * emit). Being a module (`export {}`), the `declare module` below is a proper
 * module AUGMENTATION of the real `@deepseek-ai/dsh-client-ui-slots` types —
 * the twin of the owning packages' own declarations, kept in sync manually.
 * Inert for consumers: the emitted declarations never reference the merge
 * (function bodies are erased), and `pnpm typecheck` still resolves the real
 * packages via tsconfig.json `paths`.
 */
export {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The widget manager's Configure-dialog slot (list, entry id = widget id). */
    'widgets.config': {
      kind: 'list'
      scope: 'root'
    }
    /** The card container's compact-card slot (list, entry id = widget id). */
    'widgets.card': {
      kind: 'list'
      scope: 'root'
    }
  }
}
