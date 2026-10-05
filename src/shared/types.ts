export type PresentationMode = 'live' | 'frozen' | 'privacy';

export type ToolId =
  | 'cursor'
  | 'pen'
  | 'marker'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'laser'
  | 'spotlight';

export interface AnnotationStroke {
  id: string;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  points: { x: number; y: number; p?: number }[];
  text?: string;
}

export interface Settings {
  defaultPenColor: string;
  defaultPenSize: number;
  defaultHighlighterColor: string;
  defaultHighlighterOpacity: number;
  defaultMarkerColor: string;
  defaultMarkerSize: number;
  defaultEraserSize: number;
  privacyMuteAudio: boolean;
  zoom: number;
  viewportRatio: 'full' | '16:9' | '4:3' | 'portrait';
  backgroundColor: string;
  backgroundImage?: string; // file path
  backgroundMode: 'cover' | 'contain' | 'center';
  backgroundDim: number; // 0 - 1
}

export interface Scene {
  id: string;
  name: string;
  url?: string;
  backgroundColor: string;
  backgroundImage?: string;
  backgroundMode: 'cover' | 'contain' | 'center';
  backgroundDim: number;
  viewportRatio: Settings['viewportRatio'];
  zoom: number;
  penColor: string;
  penSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPenColor: '#ff3b30',
  defaultPenSize: 4,
  defaultHighlighterColor: '#ffeb3b',
  defaultHighlighterOpacity: 0.4,
  defaultMarkerColor: '#ffffff',
  defaultMarkerSize: 10,
  defaultEraserSize: 20,
  privacyMuteAudio: true,
  zoom: 1,
  viewportRatio: '16:9',
  backgroundColor: '#0b0d12',
  backgroundMode: 'cover',
  backgroundDim: 0.5,
};
