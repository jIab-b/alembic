import type {Playback} from './common';
export interface Audio extends Playback {
  time(): Promise<number>;
}
