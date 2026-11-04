import type {Playback, Viewport, Style, Unsubscribe} from './common';
export type Camera = {world: number[]; view: number[]; clip: number[]};
export type Shape = {id: string; shape: string; center?: number[]; area?: number[]; [key: string]: unknown};
export interface I3D extends Playback {
  setViewport(rect: Viewport): Promise<void>;
  setCamera(camera: {position: number[]; target: number[]}): Promise<void>;
  drawShapes(shapes: Shape[], style: Style, tool?: string): Promise<void>;
  pick(point: number[]): Promise<unknown>;
  objects(shape: Shape): Promise<unknown>;
  capture(area?: number[]): Promise<Uint8Array | ArrayBuffer>;
  onCamera(listener: (camera: Camera) => void): Unsubscribe;
}
