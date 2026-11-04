import { hasScene } from '../../../render/registry.js';
// Validate effects in the isolated live frame. Install before authored scripts run.
export function observeEffect(registeredScene = false) {
    const scene = window.game?.scene || window.scene;
    const boxes = [...document.querySelectorAll('canvas')].map(canvas => canvas.getBoundingClientRect());
    const visibleText = [], walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    do {
        const node = walk.currentNode, element = node.parentElement;
        const text = node.nodeType === Node.TEXT_NODE ? node.textContent.trim() :
            ['::before', '::after'].map(pseudo => getComputedStyle(node, pseudo)).filter(style =>
                style.display !== 'none' && style.visibility === 'visible' && +style.opacity &&
                !['none', 'normal', '""', "''"].includes(style.content)).map(style => style.content).join('');
        if (!text || !(node.nodeType === Node.TEXT_NODE ? element : node).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const range = document.createRange();
        range.selectNode(node);
        const r = range.getBoundingClientRect();
        if (r.width && r.height && boxes.some(b => r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom))
            visibleText.push(text.slice(0, 80));
    } while (walk.nextNode());
    return {
        graphics3D: !!window.__alGraphics3D,
        scene3D: !!(registeredScene || scene?.meshes || scene?.isScene),
        camera3D: !!(scene?.activeCamera || scene?.camera || window.camera?.projectionMatrix), visibleText
    };
}
export function checkEffect(type, { graphics3D = false, scene3D = false, camera3D = false, visibleText = [] } = {}) {
    if (type === 'i2d' && (graphics3D || scene3D || camera3D))
        throw Error('i2d must not create a 3D scene or camera (WebGL/WebGPU context)');
    if (type === 'i3d' && visibleText.length)
        throw Error('i3d has visible DOM text over its canvas');
}
function installEffect(type, observe, check, scene) {
    for (const klass of [window.HTMLCanvasElement, window.OffscreenCanvas].filter(Boolean)) {
        const original = klass.prototype.getContext;
        klass.prototype.getContext = function (name, ...args) {
            const context = original.call(this, name, ...args);
            if (context && /^(webgl2?|experimental-webgl|webgpu)$/.test(name))
                window.__alGraphics3D = true;
            return context;
        };
    }
    const fail = error => parent.postMessage({ type: 'alembic.web.failure',
        error: String(error.message || error) }, location.origin);
    addEventListener('error', event => fail(event.error || event.message));
    addEventListener('unhandledrejection', event => fail(event.reason));
    let ready = false, queued = false;
    const verify = () => {
        if (!ready || queued)
            return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            try {
                check(type, observe(scene()));
            }
            catch (error) {
                parent.postMessage({ type: 'alembic.web.failure', error: error.message }, location.origin);
            }
        });
    };
    addEventListener('message', event => {
        if (event.source === parent && event.data?.type === 'alembic.web.configure') {
            ready = true;
            verify();
        }
    });
    new MutationObserver(verify).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true
    });
}
export function effectScript(path) {
    const type = path.match(/\.(i3d|i2d|audio|iframe)$/i)?.[1].toLowerCase();
    return `<script>(${installEffect})(${JSON.stringify(type)},${observeEffect},${checkEffect},${hasScene})</script>`;
}
export function checkedHTML(bytes, path) {
    const html = new TextDecoder().decode(bytes), script = effectScript(path);
    const marker = /<head(?:\s[^>]*)?>|<!doctype[^>]*>/i;
    return new TextEncoder().encode(marker.test(html) ? html.replace(marker, head => head + script) : script + html);
}
