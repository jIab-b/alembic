import {registry} from './registry.js';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
export const aliases = Object.fromEntries(['@babylonjs/core', '@babylonjs/loaders'].map(name =>
  [name, dirname(require.resolve(name + '/package.json'))]));
export const entries = Object.fromEntries(registry.filter(row => row.entry).map(({entry: [name, path]}) =>
  [name, resolve(import.meta.dirname, path)]));
