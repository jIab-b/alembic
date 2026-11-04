import type {Moment} from './replay.svelte';
/** What a selection points at: a model node, an event when a runtime draws the scene, an app's own id, or an
 * element of an embedded page (CSS selector) that an area covers. */
export type Selected = {node?: number; event?: number; id?: string; selector?: string; name: string};
/** sphere/box select what they touch; pick is one clicked object; area is a screen rectangle [x, y, w, h] in
 * fractions of the viewer, over a scene or an embedded app. context: the runtime's own description. */
export type Selection = {id: string; tag: string; shape: 'sphere' | 'box' | 'pick' | 'area'; center?: number[];
  mode?: 'prompt' | 'real'; solidId?: string;
  radius?: number; radii?: number[]; size?: number[]; area?: number[]; objects: Selected[]; context?: Record<string, unknown>; contextOmitted?: number; crop: string | null; temporal?: Moment};
export const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const encode = (text: string) => new TextEncoder().encode(text);
export async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
