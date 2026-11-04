import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { RegisterRay } from '@babylonjs/core/Culling/ray.pure.js';
import { createRender, connectRender } from '../bridge.js';
import { orbit } from './orbit.js';
import { shapePass } from './volumes.js';
import { within, framed } from './document.js';
import { bindInteraction } from '../../frontend/public/assets/play/interaction.js';
// Runs in the node's isolated renderer process. No controller-owned animation loop.
export async function bindRender({ scene, camera = scene.activeCamera, interaction: hooks, renders = ['main'],
  scenarios = [], exports: exportIds = [], play, reset }) {
    if (!scene || !camera || !hooks)
        throw Error('A scene, camera and interaction hooks are required');
    RegisterRay();
    const engine = scene.getEngine(), canvas = engine.getRenderingCanvas(), pass = shapePass(scene);
    const send = data => parent.postMessage(data, location.origin), fail = error => render.emit('failure', error);
    const gpu = engine._adapter?.info || engine._gl?.getExtension('WEBGL_debug_renderer_info');
    const description = (engine._adapter && [
        engine._adapter.info?.vendor, engine._adapter.info?.device, engine._adapter.info?.description
    ].filter(Boolean).join(' ')) || (gpu && engine._gl?.getParameter(gpu.UNMASKED_RENDERER_WEBGL));
    if (engine._adapter?.isFallbackAdapter || !description ||
        /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(description))
        throw Error('Hardware renderer is unavailable');
    let tool = '', previous = '', last = performance.now(), startPose, startTime;
    async function setIO(state) {
        if ('io_lock' in state) {
            await hooks.io_lock(state.io_lock);
            pass.visible(!state.io_lock);
            if (state.io_lock) {
                window.focus();
                canvas.focus({ preventScroll: true });
            }
        }
    }
    const bound = bindInteraction({
        ...(typeof hooks.io_lock === 'function' ? { io_lock: on => setIO({ io_lock: on }) } : {}),
        release: () => hooks.release()
    });
    await bound.ready;
    const meshes = () => scene.meshes.filter(m => m.getTotalVertices() && m.isVisible && !pass.meshes.includes(m));
    const owner = m => ({ node: m.uniqueId, name: m.name, id: m.id });
    const surface = (x, y) => {
        const r = canvas.getBoundingClientRect();
        return scene.pick((x - r.left) * engine.getRenderWidth() * engine.getHardwareScalingLevel() / r.width, (
          y - r.top) * engine.getRenderHeight() * engine.getHardwareScalingLevel() / r.height, m => meshes().includes(
          m));
    };
    const controls = orbit(canvas, camera, {
        surface: (x, y) => {
            const h = surface(x, y);
            return h?.hit ? h : null;
        }, enabled: () => !bound.state.io_lock, tool: () => tool, speed: () => Math.max(.01,
          controls.distance) * .4, menu: (x, y) => send({ type: 'alembic.web.menu', point: [x, y] }), click: (x, y) => {
            if (tool)
                send({ type: 'alembic.web.place', shape: tool, ...pick([x, y]) });
            else
                send({ type: 'alembic.dismiss' });
        }
    });
    function state() {
        const width = canvas.clientWidth, height = canvas.clientHeight, view = camera.getViewMatrix(true).clone(),
          world = view.clone().invert(), projection = camera.getProjectionMatrix(true), clip = Array.from(view.multiply(
          projection).m);
        if (!scene.useRightHandedSystem) {
            for (const i of [2, 6, 10, 14])
                view.m[i] *= -1;
            for (const i of [8, 9, 10, 11])
                world.m[i] *= -1;
        }
        return {
            width, height, region: [0, 0, width, height], world: Array.from(world.m), view: Array.from(view.m), clip,
            windowY: projection.m[5], distance: controls.distance, orthographic: camera.mode === 1
        };
    }
    function pick(point) {
        const hit = surface(...point);
        let p = hit?.hit && hit.pickedPoint;
        if (!p) {
            const r = canvas.getBoundingClientRect(), ray = scene.createPickingRay(point[0] - r.left, point[1] - r.top,
              Matrix.Identity(), camera);
            const forward = camera.getForwardRay().direction;
            p = ray.origin.add(ray.direction.scale(controls.distance / Math.max(.001, Vector3.Dot(ray.direction,
              forward))));
        }
        return {
            point: p.asArray(), object: hit?.hit ? owner(hit.pickedMesh) : null, camera: state()
        };
    }
    function objects(selection) {
        const rows = meshes().map(m => {
            m.computeWorldMatrix(true);
            const b = m.getBoundingInfo().boundingBox;
            return {
                ...owner(m), min: b.minimumWorld.asArray(), max: b.maximumWorld.asArray()
            };
        }), volume = selection.shape === 'pick' ? { ...selection, shape: 'sphere' } : selection;
        const project = p => {
            const s = Vector3.Project(Vector3.FromArray(p), Matrix.Identity(), scene.getTransformMatrix(),
              camera.viewport.toGlobal(1, 1));
            return [s.x, s.y];
        };
        return {
            objects: volume.area ? framed(rows, volume.area, project) : within(rows, volume), camera: state(), context:
              { camera: state() }
        };
    }
    async function capture(area = [0, 0, 1, 1]) {
        return new Promise((resolve, reject) => {
            pass.visible(false);
            scene.onAfterRenderObservable.addOnce(async () => {
                try {
                    const [x, y, w, h] = area, scale = Math.min(1, 512 / Math.max(w * canvas.width, h * canvas.height)),
                      out = new OffscreenCanvas(Math.max(1, Math.round(w * canvas.width * scale)), Math.max(1,
                      Math.round(h * canvas.height * scale)));
                    out.getContext('2d').drawImage(canvas, x * canvas.width, y * canvas.height, w * canvas.width,
                      h * canvas.height, 0, 0, out.width, out.height);
                    pass.visible(!bound.state.io_lock);
                    resolve(new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer()));
                }
                catch (e) {
                    pass.visible(!bound.state.io_lock);
                    reject(e);
                }
            });
        });
    }
    const render = createRender({
        setViewport: async () => engine.resize(), setCamera: async (pose) => controls.restore(pose),
        setIO,
        drawShapes: async (shapes, style, nextTool) => {
            pass.draw(shapes, style);
            pass.visible(!bound.state.io_lock);
            tool = nextTool || '';
        },
        pick: async (point) => pick(point), objects: async (selection) => objects(selection), capture,
        async play(scenario) {
            if (!play)
                throw Error('Playback binding unavailable');
            startPose ||= controls.pose();
            await play(scenario.script, scenario.id);
            startTime = performance.now();
        },
        async reset() {
            if (!reset)
                throw Error('Reset binding unavailable');
            await reset();
            if (startPose)
                controls.restore(startPose);
            startPose = null;
            startTime = null;
        }
    });
    const disconnect = connectRender(render, {});
    const before = scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        controls.tick(Math.min(.1, (now - last) / 1000));
        last = now;
    });
    const after = scene.onAfterRenderObservable.add(() => {
        if (startTime != null)
            render.emit('time', (performance.now() - startTime) / 1000);
        const camera = state(), key = JSON.stringify(camera);
        if (key !== previous) {
            previous = key;
            render.emit('camera', camera);
        }
    });
    const resize = () => engine.resize();
    addEventListener('resize', resize);
    const lock = () => {
        if (bound.state.io_lock && !document.pointerLockElement)
            canvas.requestPointerLock?.()?.catch(fail);
    };
    canvas.addEventListener('click', lock);
    render.emit('ready', {
        renders, scenarios, exports: exportIds, controls: ['orbit', 'pan', 'zoom', 'play', 'reset', 'escape'],
        interaction: bound.state, renderer: { camera: state(), gpu: { description, software: false } }
    });
    return Object.assign(render, {
        state, controls, binding: bound, async dispose() {
            removeEventListener('resize', resize);
            disconnect();
            canvas.removeEventListener('click', lock);
            scene.onBeforeRenderObservable.remove(before);
            scene.onAfterRenderObservable.remove(after);
            controls.dispose();
            pass.dispose();
            await bound.dispose();
        }
    });
}
// Nodes may use the pinned primitives rather than ship a second engine copy.
export { Engine } from '@babylonjs/core/Engines/engine.js';
export { Scene } from '@babylonjs/core/scene.js';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
export { Vector3 };
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
export { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
