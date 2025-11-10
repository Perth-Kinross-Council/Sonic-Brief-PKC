// Conditional export selecting dev or prod implementations at build time WITHOUT top-level await.
// We use static imports so older target browsers that disallow top-level await still succeed.
// NOTE: This means both modules are parsed; if bundle size becomes a concern we can refactor to
// lazy React.lazy() wrappers. For now correctness > optimal size.
import * as DevImpl from './index.dev';
import * as ProdImpl from './index.prod';

// Vite replaces import.meta.env.* with literals enabling dead-code elimination of unused branches
// in most cases, but because we reference both namespaces they may still be retained. Acceptable tradeoff.
const impl = (import.meta as any).env.DEV || (import.meta as any).env.VITE_DEBUG === 'true'
  ? DevImpl
  : ProdImpl;

export const AuthDebugPanel = impl.AuthDebugPanel;
export const UnifiedDebugDashboard = impl.UnifiedDebugDashboard;
export const DebugPanel = impl.DebugPanel;
export const TokenInspector = impl.TokenInspector;
