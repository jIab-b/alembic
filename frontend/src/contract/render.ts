// Implementations are selected once from the declared render format, outside the canvas.
export type Unsubscribe = () => void;
export type Shape = {
    id: string;
    shape: string;
    center?: number[];
    area?: number[];
    [key: string]: unknown;
};
export type Camera = {
    world: number[];
    view: number[];
    clip: number[];
};
export type Scenario = {
    id: string;
    label: string;
    render: string;
    duration: number | null;
    seek: 'none' | 'runtime';
    script?: string;
};
export interface Render {
    setViewport(rect: {
        width: number;
        height: number;
        pixelRatio: number;
    }): Promise<void>;
    setCamera(camera: {
        position: number[];
        target: number[];
    }): Promise<void>;
    setIO(state: {
        io_lock: boolean;
    }): Promise<void>;
    drawShapes(shapes: Shape[], style: {
        color: string;
        alpha: number;
    }, tool?: string): Promise<void>;
    pick(point: number[]): Promise<unknown>;
    objects(shape: Shape): Promise<unknown>;
    capture(area?: number[]): Promise<Uint8Array>;
    play(scenario: Scenario): Promise<void>;
    reset(): Promise<void>; // Restore the render and state from the start of playback.
    onReady(listener: (info: {
        renders: string[];
        scenarios: string[];
        controls: string[];
        renderer?: {
            camera: Camera;
            gpu: {
                description: string;
                software: boolean;
            };
        };
    }) => void): Unsubscribe;
    onCamera(listener: (camera: Camera) => void): Unsubscribe;
    onPlayback(listener: (time: number) => void): Unsubscribe;
    onFailure(listener: (error: Error) => void): Unsubscribe;
}
export { webSurface, loadViewer, mediaEntry, checkedHTML, surfaceFor, shapeStyle } from './surface.js';
