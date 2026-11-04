export type Unsubscribe = () => void;
export type Scenario = {id: string; label: string; render: string; duration: number | null;
  seek: 'none' | 'runtime'; script?: string};
export type Viewport = {width: number; height: number; pixelRatio: number};
export type Style = {color: string; alpha: number};
export interface Playback {
  setIO(state: {io_lock: boolean}): Promise<unknown>;
  play(scenario: Scenario): Promise<void>;
  reset(): Promise<void>;
  onReady(listener: (info: unknown) => void): Unsubscribe;
  onPlayback(listener: (time: number) => void): Unsubscribe;
  onFailure(listener: (error: Error) => void): Unsubscribe;
}
