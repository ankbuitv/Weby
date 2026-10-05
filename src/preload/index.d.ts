import type { StageAPI } from './index';
declare global {
  interface Window {
    stage: StageAPI;
  }
}
export {};
