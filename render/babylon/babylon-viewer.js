import { localRender } from './local.js';
import { orbit } from './orbit.js';
import { shapePass } from './volumes.js';
import.meta.glob('../../frontend/node_modules/@babylonjs/core/ShadersWGSL/ShadersInclude/*.js', { eager: true });
import '@babylonjs/core/ShadersWGSL/pbr.vertex.js';
import '@babylonjs/core/ShadersWGSL/pbr.fragment.js';
import { RegisterRay } from '@babylonjs/core/Culling/ray.pure.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { container, pack, framed, half, radii, within } from './document.js';
// The browser test may replace this check; production always rejects software adapters.
export async function gpuCheck(canvas) {
    if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
            const info = adapter.info || (await adapter.requestAdapterInfo?.());
            if (adapter.isFallbackAdapter || info?.isFallbackAdapter ||
                /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(`${info?.description ||
                    ''} ${info?.device || ''}`))
                throw new Error('Software WebGPU adapter is not supported');
            return 'WebGPU';
        }
    }
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl)
        throw new Error('Hardware WebGL2 is unavailable');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext)
        throw new Error('Cannot verify the WebGL2 renderer');
    if (/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(gl.getParameter(
      ext.UNMASKED_RENDERER_WEBGL)))
        throw new Error('Software WebGL2 renderer is not supported');
    return 'WebGL2';
}
export async function createViewer(host, onPlace, onBackend, onMenu = () => {
}, onDismiss = () => {
}, options = {}) {
    RegisterRay();
    const canvas = document.createElement('canvas');
    canvas.style.visibility = 'hidden';
    canvas.style.cursor = 'var(--scene-cursor)';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    let engine;
    try {
        const backend = await (options.gpuCheck || gpuCheck)(canvas);
        if (backend === 'WebGPU') {
            engine = new WebGPUEngine(canvas, {
                antialias: true, powerPreference: 'high-performance', useExactSrgbConversions: true
            });
            await engine.initAsync();
        }
        else
            engine = new Engine(canvas, true, {
                useExactSrgbConversions: true, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat:
                  !options.gpuCheck, disableWebGL1Support: true
            });
        onBackend(backend);
    }
    catch (error) {
        engine?.dispose();
        canvas.remove();
        throw error;
    }
    engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 2));
    const scene = new Scene(engine);
    options.onScene?.(scene);
    scene.useRightHandedSystem = true;
    scene.detachControl();
    scene.doNotHandleCursors = true;
    const camera = new FreeCamera('viewer', new Vector3(0, 0, 5), scene);
    camera.fov = 42 * Math.PI / 180;
    camera.minZ = .01;
    camera.maxZ = 1000;
    scene.activeCamera = camera;
    const hemi = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    hemi.intensity = 2.4 / Math.PI;
    hemi.groundColor = Color3.FromHexString('#626a60').toLinearSpace(true);
    const sun = new DirectionalLight('sun', new Vector3(-5, -9, -6), scene);
    sun.intensity = 2.5;
    let loading = false, dirty = true, model = null, clips = [], animation = null, urls = [], nodeNames = [],
      radius = .5, shape = '', worlds = new WeakMap();
    let target = Vector3.Zero(), distance = 5, azimuth = 0, elevation = 0, speed = 1, generation = 0, disposed = false,
      last = performance.now();
    const pass = shapePass(scene, () => dirty = true), overlays = pass.meshes;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const arr = v => [v.x, v.y, v.z];
    const vec = a => Vector3.FromArray(a);
    const updateTheme = () => {
        const c = getComputedStyle(host).getPropertyValue('--canvas').trim() || '#323c4b';
        const parsed = Color3.FromHexString(c);
        scene.clearColor = new Color4(parsed.r, parsed.g, parsed.b, 1);
        dirty = true;
    };
    updateTheme();
    const themeObserver = new MutationObserver(updateTheme);
    const theme = host.closest('[data-theme]');
    if (theme)
        themeObserver.observe(theme, { attributes: true, attributeFilter: ['data-theme'] });
    const resize = () => {
        engine.resize();
        dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    function aim() {
        camera.position.copyFromFloats(Math.cos(elevation) * Math.sin(azimuth) * distance + target.x, Math.sin(
          elevation) * distance + target.y, Math.cos(elevation) * Math.cos(azimuth) * distance + target.z);
        camera.setTarget(target);
        camera.computeWorldMatrix();
        scene.updateTransformMatrix(true);
        controls.restore({ position: arr(camera.position), target: arr(target) });
        dirty = true;
    }
    const axis = v => camera.getDirection(v).normalize();
    const right = () => axis(Vector3.Right());
    const up = () => axis(Vector3.Up());
    const forward = () => axis(new Vector3(0, 0, -1));
    function render() {
        scene.render();
        dirty = false;
    }
    engine.runRenderLoop(() => {
        const now = performance.now(), dt = Math.min(.1, (now - last) / 1000);
        last = now;
        if (document.hidden || host.classList.contains('inactive') || host.checkVisibility?.() === false)
            return;
        controls.tick(dt);
        if (!loading && dirty)
            render();
    });
    function owner(mesh) {
        for (let n = mesh; n; n = n.parent) {
            const pointer = n._internalMetadata?.gltf?.pointers?.find(p => /^\/nodes\/\d+$/.test(p));
            if (pointer) {
                const node = Number(pointer.split('/')[2]);
                return { node, name: nodeNames[node]?.name || '' };
            }
        }
        return null;
    }
    function surface(x, y) {
        const rect = canvas.getBoundingClientRect();
        const hit = scene.pick((x - rect.left) * engine.getRenderWidth() * engine.getHardwareScalingLevel(
          ) / rect.width, (y - rect.top) * engine.getRenderHeight() * engine.getHardwareScalingLevel() / rect.height,
          m => !!model && model.meshes.includes(m) && m.isVisible && m.isPickable);
        return hit?.hit ? hit : null;
    }
    function placement(x, y) {
        const hit = surface(x, y);
        if (hit)
            return { point: arr(hit.pickedPoint), object: owner(hit.pickedMesh) };
        const rect = canvas.getBoundingClientRect(), ray = scene.createPickingRay((
          x - rect.left) * engine.getRenderWidth() * engine.getHardwareScalingLevel() / rect.width, (
          y - rect.top) * engine.getRenderHeight() * engine.getHardwareScalingLevel() / rect.height, Matrix.Identity(),
          camera);
        const depth = Math.max(camera.minZ * 8, controls.distance);
        return {
            point: arr(ray.origin.add(ray.direction.scale(depth / Math.max(.001, Vector3.Dot(ray.direction, forward(
              )))))), object: null
        };
    }
    const controls = orbit(canvas, camera, {
        surface, changed: () => dirty = true, enabled: () => !host.classList.contains('inactive'), speed: () => speed,
        tool: () => shape, menu: onMenu, click(x, y) {
            if (!model)
                return;
            if (!shape)
                onDismiss();
            else if (shape === 'pick') {
                const hit = surface(x, y);
                if (hit)
                    onPlace(arr(hit.pickedPoint), radius, owner(hit.pickedMesh));
                else
                    onDismiss();
            }
            else {
                const at = placement(x, y);
                onPlace(at.point, radius, at.object);
            }
        }
    });
    function clear() {
        model?.dispose();
        model = null;
        clips = [];
        animation = null;
        worlds = new WeakMap();
        urls.forEach(URL.revokeObjectURL);
        urls = [];
    }
    function selectAnimation(index) {
        if (!clips[index])
            return null;
        clips.forEach(c => c.stop());
        const clip = clips[index];
        clip.start(false);
        clip.pause();
        const fps = clip.targetedAnimations[0]?.animation.framePerSecond || 60;
        animation = {
            duration: (clip.to - clip.from) / fps, clip: clip.name || `Animation ${index + 1}`, seek(time) {
                clip.goToFrame(clamp(clip.from + time * fps, clip.from, clip.to));
                worlds = new WeakMap();
                dirty = true;
            }
        };
        return animation;
    }
    async function load(bytes, folder, path, keepCamera = false, upAxis = 'y') {
        const current = ++generation, nextUrls = [];
        loading = true;
        canvas.style.visibility = 'hidden';
        const mark = name => options.onMeasure?.(name, performance.now());
        mark('loadStart');
        try {
            const parsed = container(bytes), json = parsed.json;
            if ((json.extensionsUsed || []).some(name => [
                'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'EXT_lights_image_based',
                'EXT_lights_ies', 'MSFT_audio_emitter', 'KHR_interactivity'
            ].includes(name)))
                throw new Error('Unsupported glTF extension requires an external runtime or resource');
            nodeNames = (json.nodes || []).map(n => ({
                ...n, name: n.name || (json.meshes?.[n.mesh]?.primitives.length === 1 && n.camera === undefined ? (
                  json.meshes[n.mesh].name || 'mesh_' + n.mesh).replace(/\s/g, '_').replace(/[\[\].:/]/g, '') : '')
            }));
            let source = bytes;
            {
                const base = new URL(path.split('/').map(encodeURIComponent).join('/'), location.origin + '/');
                for (const item of [...(json.buffers || []), ...(json.images || [])]) {
                    if (!item.uri || item.uri.startsWith('data:'))
                        continue;
                    const resolved = new URL(item.uri, base);
                    if (resolved.origin !== location.origin)
                        throw new Error('External model resource');
                    const data = await folder.read(decodeURIComponent(resolved.pathname.slice(1)));
                    item.uri = URL.createObjectURL(new Blob([data]));
                    nextUrls.push(item.uri);
                }
                source = /\.gltf$/i.test(path) ? 'data:' + JSON.stringify(json) : pack(json, parsed.bin);
            }
            mark('resourcesReady');
            const asset = await LoadAssetContainerAsync(source, scene, {
                pluginExtension: /\.gltf$/i.test(path) ?
                    '.gltf' : '.glb'
            });
            if (disposed || current !== generation) {
                asset.dispose();
                return;
            }
            mark('assetReady');
            clear();
            model = asset;
            urls = nextUrls.splice(0);
            asset.addAllToScene();
            for (const material of asset.materials)
                if (material.brdf)
                    material.brdf.baseDiffuseModel = 2;
            clips = asset.animationGroups;
            clips.forEach(c => c.stop());
            if (clips.length)
                selectAnimation(0);
            if (upAxis === 'z')
                for (const root of asset.rootNodes)
                    root.rotation.x = -Math.PI / 2;
            let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
            for (const mesh of asset.meshes) {
                mesh.computeWorldMatrix(true);
                if (!mesh.getTotalVertices())
                    continue;
                const b = mesh.getBoundingInfo().boundingBox;
                min = Vector3.Minimize(min, b.minimumWorld);
                max = Vector3.Maximize(max, b.maximumWorld);
            }
            const empty = !Number.isFinite(min.x);
            const span = empty ? new Vector3(2, 2, 2) : max.subtract(min);
            radius = Math.max(span.length() * .05, .001);
            speed = Math.max(span.length(), .01) * .4;
            if (!keepCamera) {
                camera.fov = 42 * Math.PI / 180;
                const br = Math.max(span.length() / 2, .0001), angle = Math.min(camera.fov / 2, Math.atan(Math.tan(
                  camera.fov / 2) * canvas.clientWidth / Math.max(1, canvas.clientHeight)));
                distance = br / Math.sin(angle) * 1.1;
                target = empty ? Vector3.Zero() : min.add(max).scale(.5);
                azimuth = Math.atan2(.65, .9);
                elevation = Math.asin(.5 / Math.hypot(.65, .5, .9));
                camera.minZ = Math.max(br / 10000, .000001);
                camera.maxZ = Math.max(distance + br * 100, camera.minZ * 100);
                const authored = asset.cameras[0];
                if (authored) {
                    authored.computeWorldMatrix(true);
                    const position = authored.globalPosition.clone(), f = authored.getDirection(new Vector3(0, 0, -1)),
                      extras = authored.metadata?.gltf?.extras || {};
                    distance = Number(extras.alembic_focus_distance) > 0 ? Number(extras.alembic_focus_distance) :
                        Math.max(span.length() * .6, 1);
                    target = position.add(f.scale(distance));
                    const offset = position.subtract(target);
                    azimuth = Math.atan2(offset.x, offset.z);
                    elevation = Math.asin(clamp(offset.y / distance, -1, 1));
                    camera.fov = authored.fov;
                    camera.minZ = authored.minZ;
                    camera.maxZ = authored.maxZ;
                    if (Number(extras.alembic_navigation_speed) > 0)
                        speed = Number(extras.alembic_navigation_speed);
                }
                aim();
            }
            mark('scenePrepared');
            await scene.whenReadyAsync();
            mark('sceneReady');
            if (!disposed && current === generation) {
                render();
                mark('rendered');
                if (engine instanceof WebGPUEngine) {
                    engine.flushFramebuffer();
                    await engine._device.queue.onSubmittedWorkDone();
                }
                else {
                    engine._gl.finish();
                }
                mark('gpuComplete');
                if (!disposed && current === generation) {
                    loading = false;
                    canvas.style.visibility = '';
                }
            }
        }
        catch (error) {
            if (!disposed && current === generation) {
                clear();
                volumes([]);
                dirty = true;
                loading = false;
                canvas.style.visibility = '';
            }
            throw error;
        }
        finally {
            nextUrls.forEach(URL.revokeObjectURL);
        }
    }
    const volumes = pass.draw;
    function previewSolids(items) {
        const byId = new Map(items.map(i => [i.solidId, i]));
        for (const node of [...(model?.transformNodes || []), ...(model?.meshes || [])]) {
            const item = byId.get(node.metadata?.gltf?.extras?.alembicSolid?.id);
            if (item) {
                node.position.copyFrom(vec(item.center));
                node.scaling.copyFrom(vec(item.shape === 'sphere' ? radii(item) : item.size));
                node.computeWorldMatrix(true);
            }
        }
        worlds = new WeakMap();
        dirty = true;
    }
    function project(p) {
        const point = vec(p);
        if (Vector3.Dot(point.subtract(camera.position), forward()) <= 0)
            return null;
        const v = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), new Viewport(0, 0,
          canvas.clientWidth, canvas.clientHeight));
        return [v.x, v.y];
    }
    function objects(volume) {
        const items = [];
        for (const mesh of model?.meshes || []) {
            if (!mesh.getTotalVertices())
                continue;
            let world = worlds.get(mesh);
            if (!world) {
                const positions = mesh.getPositionData(true, true);
                if (!positions)
                    continue;
                mesh.computeWorldMatrix(true);
                const matrix = mesh.getWorldMatrix(), min = new Vector3(Infinity, Infinity, Infinity),
                  max = new Vector3(-Infinity, -Infinity, -Infinity);
                for (let i = 0; i < positions.length; i += 3) {
                    const p = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), matrix);
                    min.minimizeInPlace(p);
                    max.maximizeInPlace(p);
                }
                world = { min: arr(min), max: arr(max) };
                worlds.set(mesh, world);
            }
            const hit = owner(mesh);
            if (hit)
                items.push({ ...hit, ...world });
        }
        return volume.shape === 'area' ? framed(items, volume.area, p => {
            const s = project(p);
            return s && [s[0] / canvas.clientWidth, s[1] / canvas.clientHeight];
        }) : within(items, volume);
    }
    async function crop(volume) {
        let left, top, rightEdge, bottom;
        if (volume.shape === 'area') {
            [left, top] = volume.area;
            rightEdge = left + volume.area[2];
            bottom = top + volume.area[3];
        }
        else {
            const h = half(volume), points = [];
            for (const x of [-1, 1])
                for (const y of [-1, 1])
                    for (const z of [-1, 1]) {
                        const p = project(volume.center.map((v, i) => v + h[i] * [x, y, z][i]));
                        if (p)
                            points.push([p[0] / canvas.clientWidth, p[1] / canvas.clientHeight]);
                    }
            if (!points.length)
                return null;
            left = Math.min(...points.map(p => p[0]));
            rightEdge = Math.max(...points.map(p => p[0]));
            top = Math.min(...points.map(p => p[1]));
            bottom = Math.max(...points.map(p => p[1]));
        }
        left = Math.max(0, left);
        top = Math.max(0, top);
        rightEdge = Math.min(1, rightEdge);
        bottom = Math.min(1, bottom);
        if (rightEdge <= left || bottom <= top)
            return null;
        const w = (rightEdge - left) * canvas.width, h = (bottom - top) * canvas.height, scale = Math.min(1,
          512 / Math.max(w, h)), out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * scale));
        out.height = Math.max(1, Math.round(h * scale));
        overlays.forEach(m => m.setEnabled(false));
        render();
        out.getContext('2d').drawImage(canvas, left * canvas.width, top * canvas.height, w, h, 0, 0, out.width,
          out.height);
        overlays.forEach(m => m.setEnabled(true));
        dirty = true;
        const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    }
    let local;
    aim();
    const viewer = {
        project, locate: placement, axes: () => ({ right: arr(right()), up: arr(up()), forward: arr(forward()) }),
        dragFrame(point) {
            const depth = Vector3.Dot(vec(point).subtract(camera.position), forward());
            return {
                right: arr(right()), up: arr(up()), forward: arr(forward()), scale: 2 * Math.max(camera.minZ,
                  depth) * Math.tan(camera.fov / 2) / Math.max(1, canvas.clientHeight)
            };
        }, pose: () => ({ position: arr(camera.position), forward: arr(forward()) }), replayPose: controls.pose,
        restoreReplayPose: controls.restore, animation: () => animation, animations: () => clips.map((c, i) => c.name ||
          `Animation ${i + 1}`), selectAnimation, load, volumes, previewSolids, objects, crop,
        defaultRadius: () => radius, tool: value => {
            shape = value;
            canvas.style.cursor = 'var(--scene-cursor)';
        }, dispose() {
            local?.dispose();
            disposed = true;
            generation++;
            observer.disconnect();
            themeObserver.disconnect();
            controls.dispose();
            volumes([]);
            clear();
            scene.dispose();
            engine.dispose();
            canvas.remove();
        }
    };
    local = localRender(viewer, canvas, controls, pass, resize);
    const dispose = viewer.dispose;
    Object.defineProperties(viewer, Object.getOwnPropertyDescriptors(local));
    viewer.dispose = dispose;
    return viewer;
}
