import type { WbView, WhiteboardDoc } from '../../shared/types';
import { contentBounds, drawWhiteboard, fitView } from './render';

/**
 * PNG export.
 *
 * Rasterised on demand from the vector document — the board is never stored as
 * a bitmap, so exporting happens only when the teacher asks for it. The output
 * is capped so a board with a huge pan range cannot allocate a giant canvas.
 */

const MAX_SIDE = 4096;

export async function renderBoardPng(doc: WhiteboardDoc, mode: 'view' | 'all', view?: WbView): Promise<string | null> {
  if (!doc.objects.length) return null;

  const bounds = mode === 'view' && view
    ? { x: view.x, y: view.y, width: 1600 / view.zoom, height: 900 / view.zoom }
    : contentBounds(doc.objects);

  const scale = Math.min(1, MAX_SIDE / Math.max(bounds.width, bounds.height));
  const width = Math.max(16, Math.round(bounds.width * scale));
  const height = Math.max(16, Math.round(bounds.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Wait for every referenced image so the export is not full of placeholders.
  await preloadImages(doc);

  drawWhiteboard({
    ctx,
    width,
    height,
    dpr: 1,
    view: { x: bounds.x, y: bounds.y, zoom: scale },
    objects: doc.objects,
    themeId: doc.theme,
  });

  return canvas.toDataURL('image/png');
}

/** The audience surface uses `fitView` for boards that were never panned. */
export function exportViewFor(doc: WhiteboardDoc, size: { w: number; h: number }): WbView {
  return doc.view ?? fitView(doc.objects, size);
}

function preloadImages(doc: WhiteboardDoc): Promise<void> {
  const sources = doc.objects.filter((o) => o.kind === 'image').map((o) => (o as { src: string }).src);
  if (!sources.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = sources.length;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    for (const src of sources) {
      const img = new Image();
      img.onload = img.onerror = () => {
        if (--left <= 0) {
          clearTimeout(timer);
          finish();
        }
      };
      img.src = src;
    }
  });
}
