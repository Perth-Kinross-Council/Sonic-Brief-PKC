// Ambient declarations for pdfjs ESM build and worker URL imports used by Vite
// These improve editor DX only and do not affect runtime.

declare module 'pdfjs-dist/build/pdf.mjs' {
  // Minimal surface used in our code; widen to any to avoid tight coupling
  export const GlobalWorkerOptions: any;
  export function getDocument(data: any): any;
  const _default: any;
  export default _default;
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const src: string;
  export default src;
}
