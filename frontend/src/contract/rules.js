import { labels } from '../../../render/formats.js';
import { checkEffect } from './effect.js';
import { types as nodeTypes, extensions } from './types.js';
import { readCanvas, resolveNodePath, isTypedNode, interactionRows } from '../canvas.js';
const id = value => typeof value === 'string' && /^[A-Za-z][\w-]{0,63}$/.test(value);
const instance = value => typeof value === 'string' && value.length <= 160 && value.split('.').every(id);
const types = new Set(['string', 'number', 'integer', 'boolean']);
const text = (bytes, hints = false) => {
    if (bytes.length > 65536)
        throw new Error('Node index exceeds 64 KiB');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(
        hints ? source.replace(/^(?:property|action|event)(?:\t.*)?$/gm, '') : source))
        throw new Error('Invalid node index text');
    return source.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith('#')).map(
      line => line.split('\t'));
};
const schema = value => {
    const parts = value === '-' ? [] : value.split(','), names = new Set();
    return parts.length <= 8 && parts.every(part => {
        const [name, type, extra] = part.split(':');
        if (extra || !id(name) || !types.has(type) || names.has(name))
            return false;
        names.add(name);
        return true;
    });
};
export function nodeType(path) {
    const name = typeof path === 'string' && path.match(/\.(i3d|i2d|audio|iframe)$/i)?.[1].toLowerCase();
    if (!name)
        throw new Error('Expected a typed node');
    return nodeTypes[name];
}
export function validateRender(path, format, file, { child = false } = {}) {
    const type = nodeType(path);
    if (format === 'app' && type.formats.includes(format) && /^http:\/\//.test(file)) {
        const url = new URL(file);
        if (url.username || url.password || url.hash) throw new Error('Invalid app URL');
        return;
    }
    if (!type.formats.includes(format) || typeof file !== 'string' || !(extensions[format] || [format]).includes(
      file.split('.').at(-1).toLowerCase()))
        throw new Error('Invalid render export');
    if (child && type.children && !type.children.includes(format))
        throw new Error('Live ' + format + ' child is not allowed in i3d');
}
// Observations supplied by a browser check; this module has no DOM or engine code.
export function validateRenderEffect(path, effect) {
    nodeType(path);
    checkEffect(path.split('.').at(-1).toLowerCase(), effect);
}
export function readExports(bytes, path, options) {
    nodeType(path);
    const rows = text(bytes, true);
    if (rows.shift()?.join('\t') !== 'exports-index\t1')
        throw new Error('Unsupported exports index version');
    const nodes = [], views = [], exports = [], interactions = [], ids = new Set();
    const renderIds = new Set(rows.filter(row => row[0] === 'render').map(row => row[1]));
    for (const [kind, ...parts] of rows) {
        if (kind === 'render' && parts.length === 3) {
            const [name, format, file] = parts;
            if (!id(name) || ids.has(name) || views.length === 16)
                throw new Error('Invalid render export');
            validateRender(path, format, file, options);
            const url = format === 'app' && file.startsWith('http://') ? file : null;
            const resolved = url ? path + '/__remote__/' + encodeURIComponent(url) + '/index.html' : resolveNodePath(path, file);
            if (!resolved.startsWith(path + '/'))
                throw new Error('Render export must stay inside its node');
            ids.add(name);
            views.push(name);
            nodes.push({
                id: name, path: resolved, label: labels[format] || format.toUpperCase(), inputs: [], format, ...(url ? {url} : {})
            });
        }
        else if (kind === 'interaction' && parts.length === 3)
            interactions.push(parts);
        else if (['property', 'action', 'event'].includes(kind)) {
            const [scope, name, type] = parts;
            if (parts.length !== 3 || !id(name) || ids.has(name) || renderIds.has(name) ||
                scope !== '*' && !renderIds.has(scope) || !(kind === 'property' ? types.has(type) : schema(type)))
                continue;
            if (exports.length >= 128 - renderIds.size) continue;
            ids.add(name);
            exports.push({ id: name, kind, scope, type });
        }
        else
            throw new Error('Invalid exports index record');
    }
    if (!views.length)
        throw new Error('Export scope has no render');
    interactionRows(nodes, interactions);
    const glbs = nodes.filter(node => ['glb', 'gltf'].includes(node.format));
    if (glbs.length > 1)
        for (const node of glbs)
            node.label = `GLB · ${node.path.split('/').at(-1).replace(/\.(glb|gltf)$/i, '')}`;
    const doc = readCanvas(new TextEncoder().encode(JSON.stringify({
        format: 'alembic.canvas', version: 1, title: path.split('/').pop(), nodes, views, defaultView: views[0]
    })), /\.i3d$/i.test(path));
    return { ...doc, exports, canonical: true };
}
export function readPlaybacks(bytes, document) {
    const rows = text(bytes);
    const header = rows.shift()?.join('\t'), v2 = header === 'playbacks-index\t2';
    if (!v2 && header !== 'playbacks-index\t1')
        throw new Error('Unsupported playbacks index version');
    const scenarios = [], ids = new Set(), uses = [];
    for (const [kind, ...parts] of rows) {
        if (kind === 'scenario' && parts.length === (v2 ? 6 : 5)) {
            const [name, label, render, duration, seek, encoded] = parts;
            let script;
            if (v2) {
                try {
                    script = JSON.parse(encoded);
                }
                catch {
                    throw new Error('Invalid playback script');
                }
                if (typeof script !== 'string' || !script.trim())
                    throw new Error('Invalid playback script');
            }
            if (!id(name) || ids.has(name) || !label || label.length > 80 || !document.views.includes(render) ||
                !(duration === 'unknown' || /^\d+(?:\.\d+)?$/.test(duration) && +duration > 0 && +duration <= 3600) ||
                  !['none', 'runtime'].includes(seek))
                throw new Error('Invalid playback scenario');
            ids.add(name);
            scenarios.push({
                id: name, label, render, duration: duration === 'unknown' ? null : +duration, seek, uses: [], ...(v2 ?
                  { script } : {})
            });
        }
        else if (kind === 'use' && parts.length === 4) {
            const [scenario, target, dependency, child] = parts;
            if (!id(scenario) || !instance(target) || !id(dependency) || !id(child))
                throw new Error('Invalid playback child reference');
            uses.push({ scenario, instance: target, dependency, playback: child });
        }
        else
            throw new Error('Invalid playbacks index record');
        if (scenarios.length > 32 || uses.length > 64)
            throw new Error('Node playbacks exceed v1 limit');
    }
    for (const use of uses) {
        const scenario = scenarios.find(row => row.id === use.scenario);
        if (!scenario || scenario.uses.some(row => row.instance === use.instance && row.playback === use.playback))
            throw new Error('Unresolved or duplicate playback child reference');
        scenario.uses.push({
            instance: use.instance, dependency: use.dependency, playback: use.playback
        });
    }
    return scenarios;
}
// An authored import may enter only aliases declared by each containing node.
// Ordinary source directories are valid leaves; only a nested alias needs a node descriptor.
export async function resolveWebPath(root, request, dependencies, nestedDependencies) {
    const parts = typeof request === 'string' && request.length <= 500 ? request.split('/') : [];
    if (!parts.length || parts.some(part => !part || part.startsWith('.') || part.includes('\\')))
        throw new Error('Invalid web source path');
    let base = root, index = 0, declared = dependencies || {};
    while (parts[index] === '_deps') {
        if (index >= 16 || !id(parts[index + 1]) || !Object.hasOwn(declared, parts[index + 1]))
            throw new Error('Undeclared web dependency');
        const path = declared[parts[index + 1]]?.path;
        base = resolveNodePath(base, path);
        index += 2;
        if (isTypedNode(base))
            declared = await nestedDependencies(base);
        else if (parts[index] === '_deps')
            throw new Error('Nested web dependency needs a typed node');
    }
    if (index >= parts.length)
        throw new Error('Web source path needs a file');
    return base + '/' + parts.slice(index).join('/');
}
