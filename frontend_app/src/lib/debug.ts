// Centralized debug logging helpers
// Ensures debug output is emitted only when VITE_DEBUG is true and can be tree-shaken in prod builds.
import { debugConfig } from '@/env';

/* eslint-disable no-console */
export const debugLog = (...args: any[]) => {
  if (debugConfig.isEnabled()) console.log(...args);
};
export const debugWarn = (...args: any[]) => {
  if (debugConfig.isEnabled()) console.warn(...args);
};
export const debugError = (...args: any[]) => {
  if (debugConfig.isEnabled()) console.error(...args);
};
export const debugGroup = (label: string) => {
  if (debugConfig.isEnabled()) console.group(label);
};
export const debugGroupEnd = () => {
  if (debugConfig.isEnabled()) console.groupEnd();
};
export const debugTime = (label: string) => {
  if (debugConfig.isEnabled()) console.time(label);
};
export const debugTimeEnd = (label: string) => {
  if (debugConfig.isEnabled()) console.timeEnd(label);
};
export const debugClear = () => {
  if (debugConfig.isEnabled()) console.clear();
};

export const debug = { log: debugLog, warn: debugWarn, error: debugError, group: debugGroup, groupEnd: debugGroupEnd, time: debugTime, timeEnd: debugTimeEnd, clear: debugClear };

// Usage:
// Replace: if (debugConfig.isEnabled()) console.log('message', value);
// With:    debugLog('message', value);
// For errors: debugError('message', err);
// Policy:
//  - Use debugLog/debugWarn/debugGroup for diagnostic, performance, tracing output.
//  - Leave raw console.error ONLY for user-impacting failures (network, file processing) that must surface even when debug disabled.
//  - Use debug.clear() instead of console.clear() so it remains gated.
//  - Avoid logging sensitive data (tokens, PII); redact or omit.
//  - Prefer structured objects as additional params over string concatenation for better devtools filtering.
export function prettyPrint(object: unknown): void {
  console.dir(object, { depth: Infinity, colors: true });
}
