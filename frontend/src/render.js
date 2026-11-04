import {renderablePath} from '../../render/registry.js';
// A completed render is announced atomically after all its resources are ready.
export function renderNotice(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 200 ||
      typeof value.path !== 'string' || value.path.includes('\\') || value.path.includes('\0') ||
      value.path.split('/').some(part => !part || part.startsWith('.')) ||
      !(value.path.endsWith('.canvas') || renderablePath(value.path))) return null;
  return {id: value.id, path: value.path};
}
