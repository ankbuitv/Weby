import type { JuztApi, JuztLiveApi, JuztOverlayApi } from './index';

declare global {
  interface Window {
    /** Role-specific bridge (prep | live | overlay). */
    juzt: JuztApi & JuztLiveApi & JuztOverlayApi;
    /** Back-compat alias kept for the audience renderer's naming. */
    stage: JuztApi & JuztLiveApi & JuztOverlayApi;
  }
}

export {};
