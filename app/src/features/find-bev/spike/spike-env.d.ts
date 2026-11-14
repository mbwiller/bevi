// SPIKE S1 findings, both needed by a fresh checkout's `tsc` (CI), neither by a laptop that has run Expo:
//
// 1. `*.module.css` is typed by expo/types, which reaches tsc only through the gitignored
//    expo-env.d.ts. The same reference, committed. (Declaring the module by hand instead would clash
//    with expo-env.d.ts wherever that file exists: two default exports.)
/// <reference types="expo/types" />

// 2. @types/react-dom is not installed, and the island's tests mount with react-dom's createRoot.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
