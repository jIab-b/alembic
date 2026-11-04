import type {Playback, Viewport, Style} from './common';
export interface I2D extends Playback {
  setViewport(rect: Viewport): Promise<void>;
  drawShapes(shapes: {id: string; shape: 'area'; area: number[]}[], style: Style): Promise<void>;
  capture(area?: number[]): Promise<Uint8Array | ArrayBuffer>;
}
