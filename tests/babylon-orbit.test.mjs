import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Node resolves the same pinned package that Vite aliases for renderer sources.
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const {NullEngine} = await import(pathToFileURL(require.resolve('@babylonjs/core/Engines/nullEngine.js')).href);
const {Scene} = await import(pathToFileURL(require.resolve('@babylonjs/core/scene.js')).href);
const {FreeCamera} = await import(pathToFileURL(require.resolve('@babylonjs/core/Cameras/freeCamera.js')).href);
const {ArcRotateCamera} =
  await import(pathToFileURL(require.resolve('@babylonjs/core/Cameras/arcRotateCamera.js')).href);
const {Vector3, Matrix} = await import(pathToFileURL(require.resolve('@babylonjs/core/Maths/math.vector.js')).href);
const {Viewport} = await import(pathToFileURL(require.resolve('@babylonjs/core/Maths/math.viewport.js')).href);
const math = '@babylonjs/core/Maths/math.vector.js';
const source = (await readFile(new URL('../render/babylon/orbit.js', import.meta.url), 'utf8'))
    .replace(math, pathToFileURL(require.resolve(math)).href);
const {orbit} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// Recorded from the previous camera reference before removing its unused renderer dependency.
const reference = JSON.parse(await readFile(new URL('./fixtures/orbit-reference.json', import.meta.url)));
function mainDeltas(pose, input, fov) {
    assert.deepEqual(pose, reference.pose); assert.equal(fov, reference.fov);
    return reference.directions[input];
}

test('inspection keeps its pivot centred and matches main directions for both camera types and handednesses', () => {
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    const engine = new NullEngine({renderWidth: 1200, renderHeight: 800});
    const rows = [], steps = [[1, 0], [19, -7], [-3, 2], [41, 13], [-11, -23], [2, 1]];
    const inputs = [
        ['orbit', 0, false], ['right-pan', 2, false], ['shift-pan', 0, true],
        ...['KeyW', 'KeyA', 'KeyS', 'KeyD'].map(key => [key])
    ];
    try {
        // arena: LH FreeCamera; robot preview: LH ArcRotate; box: RH ArcRotate; GLB viewer: RH FreeCamera.
        for (const Camera of [ArcRotateCamera, FreeCamera]) for (const rh of [false, true]) {
            const scene = new Scene(engine);
            scene.useRightHandedSystem = rh;
            const camera = Camera === FreeCamera ? new Camera('inspect', new Vector3(3, 2, 5), scene)
                : new Camera('inspect', 1, 1, 6, Vector3.Zero(), scene);
            const canvas = Object.assign(new EventTarget(), {
                style: {}, clientWidth: 1200, clientHeight: 800, setPointerCapture() {}
            });
            const pose = {position: [3, 2, 5], target: [0, 0, 0]};
            camera.position.copyFromFloats(...pose.position);
            camera.setTarget(Vector3.Zero());
            const controls = orbit(canvas, camera), viewport = new Viewport(0, 0, 1200, 800);
            const project = point => Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), viewport);
            const error = () => {
                const p = project(Vector3.FromArray(controls.pose().target));
                return Math.hypot(p.x - 600, p.y - 400);
            };
            const event = (type, x, y, button = 0, shiftKey = false) => canvas.dispatchEvent(
                Object.assign(new Event(type), {clientX: x, clientY: y, button, shiftKey, pointerId: 1}));
            const key = (type, code) => window.dispatchEvent(Object.assign(new Event(type), {code}));
            const row = {camera: Camera.name, rh, drag: [], wasd: {}, directions: {}};
            try {
                controls.restore(pose);
                event('pointerdown', 900, 600);
                let x = 900, y = 600;
                for (const [dx, dy] of steps) {
                    event('pointermove', x += dx, y += dy);
                    row.drag.push(error());
                }
                event('pointerup', x, y);
                for (const [input, button, shift] of inputs) {
                    controls.restore(pose);
                    const right = camera.getDirection(Vector3.Right()).normalize();
                    const up = camera.getDirection(Vector3.Up()).normalize();
                    const forward = camera.getDirection(new Vector3(0, 0, rh ? -1 : 1)).normalize();
                    const point = right.scale(.6).add(up.scale(.4)).subtract(forward.scale(1.5));
                    const before = project(point), deltas = [], errors = [];
                    if (button !== undefined) {
                        for (const [dx, dy] of [[-60, 0], [60, 0], [0, -60], [0, 60]]) {
                            controls.restore(pose);
                            event('pointerdown', 900, 600, button, shift);
                            for (let n = 1; n <= 8; n++)
                                event('pointermove', 900 + dx * n / 8, 600 + dy * n / 8, button, shift);
                            event('pointerup', 900 + dx, 600 + dy, button, shift);
                            const after = project(point), delta = dx ? after.x - before.x : after.y - before.y;
                            deltas.push(delta);
                        }
                    } else {
                        key('keydown', input);
                        for (const dt of [.007, .031, .011, .049, .016, .003]) {
                            controls.tick(dt);
                            errors.push(error());
                        }
                        key('keyup', input);
                        const after = project(point);
                        deltas.push(after.x - before.x, after.y - before.y);
                        row.wasd[input] = errors;
                    }
                    row.directions[input] = deltas;
                    mainDeltas(pose, input, camera.fov).forEach((expected, i) =>
                        assert.ok(Math.abs(deltas[i] - expected) < .001,
                            `${Camera.name} RH=${rh} ${input}: ${deltas[i]}px vs main ${expected}px`));
                }
                rows.push(row);
            } finally { controls.dispose(); scene.dispose(); }
        }
        console.log('MEASURE ' + JSON.stringify(rows));
        for (const row of rows) {
            for (const n of [...row.drag, ...Object.values(row.wasd).flat()])
                assert.ok(n < .001, `${row.camera} RH=${row.rh}: pivot offset ${n}px`);
        }
    } finally { engine.dispose(); globalThis.window = previousWindow; }
});

test('camera drag pointer lock transitions, refusal and cursor-dependent tools', async () => {
    const previous = globalThis.window; globalThis.window = new EventTarget();
    const engine = new NullEngine(), scene = new Scene(engine);
    const camera = new FreeCamera('inspect', new Vector3(3, 2, 5), scene); camera.setTarget(Vector3.Zero());
    try {
        for (const mode of ['lock', 'reject', 'error', 'throw', 'tool']) for (const button of [0, 2]) {
            const doc = Object.assign(new EventTarget(), {pointerLockElement: null});
            let requests = 0, clicks = 0;
            const canvas = Object.assign(new EventTarget(), {ownerDocument: doc, style: {},
                clientWidth: 1200, clientHeight: 800, setPointerCapture() {}, requestPointerLock() {
                    requests++;
                    if (mode === 'throw') throw Error('refused');
                    if (mode === 'reject') return Promise.reject(Error('refused'));
                    if (mode === 'error') { doc.dispatchEvent(new Event('pointerlockerror')); return; }
                    doc.pointerLockElement = canvas; canvas.dispatchEvent(new Event('lostpointercapture'));
                    doc.dispatchEvent(new Event('pointerlockchange'));
                }});
            doc.exitPointerLock = () => {
                doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
            };
            const controls = orbit(canvas, camera, {tool: () => mode === 'tool' ? 'sphere' : '',
                click: () => clicks++, menu: () => clicks++});
            const event = (type, x = 100, movementX = 0) => canvas.dispatchEvent(Object.assign(new Event(type),
                {clientX: x, clientY: 100, movementX, movementY: 0, button, pointerId: 1}));
            try {
                event('pointerdown'); event('pointermove', 102); event('pointerup', 102);
                assert.equal(requests, 0, mode + ': threshold'); assert.equal(clicks, 1); clicks = 0;
                event('pointerdown'); event('pointermove', 120, 20); await Promise.resolve();
                assert.equal(requests, mode === 'tool' ? 0 : 1);
                const entered = controls.pose();
                if (mode === 'lock') {
                    event('pointermove', 100, 20000); assert.deepEqual(controls.pose(), entered, 'entry spike ignored');
                    event('pointermove', 100, 15);
                    assert.notDeepEqual(controls.pose(), entered, 'capture loss survives; relative deltas work');
                    const relative = controls.pose(); controls.restore(entered); doc.exitPointerLock();
                    event('pointerdown'); event('pointermove', 115, 15);
                    for (const k of ['position', 'target']) controls.pose()[k].forEach((v, i) =>
                        assert.ok(Math.abs(v - relative[k][i]) < 1e-10, 'no transition jump or double count'));
                } else {
                    event('pointermove', 140, 20); assert.notDeepEqual(controls.pose(), entered, 'refusal still drags');
                }
                event('pointerup'); assert.equal(clicks, 0, 'no click at frozen client coordinates');
                assert.equal(canvas.style.cursor, 'var(--scene-cursor)');
                if (mode === 'lock') for (const end of ['exit', 'blur', 'dispose']) {
                    event('pointerdown'); event('pointermove', 120);
                    if (end === 'exit') doc.exitPointerLock();
                    else if (end === 'blur') window.dispatchEvent(new Event('blur')); else controls.dispose();
                    const ended = controls.pose(); event('pointermove', 160, 40);
                    assert.deepEqual(controls.pose(), ended, end); assert.equal(doc.pointerLockElement, null);
                }
            } finally { controls.dispose(); }
        }
    } finally { scene.dispose(); engine.dispose(); globalThis.window = previous; }
});
