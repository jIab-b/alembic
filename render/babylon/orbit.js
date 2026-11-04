import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// Main's inspection control: pointer deltas directly update the pose, with no engine inputs.
export function orbit(canvas, camera, {surface, changed = () => {}, enabled = () => true,
    click = () => {}, menu = () => {}, tool = () => '', speed = () => 1} = {}) {
    camera.detachControl(); camera.inertia = 0;
    for (const key of ['inertialAlphaOffset', 'inertialBetaOffset', 'inertialRadiusOffset',
        'inertialPanningX', 'inertialPanningY']) if (key in camera) camera[key] = 0;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), v = a => Vector3.FromArray(a);
    const listeners = [], keys = new Set(), doc = canvas.ownerDocument;
    let target = camera.getTarget().clone(), distance = 1, azimuth = 0, elevation = 0;
    let drag, press, context, requesting, held = false;
    const axis = n => camera.getDirection(n).normalize(), right = () => axis(Vector3.Right());
    const up = () => axis(Vector3.Up());
    const forward = () => axis(new Vector3(0, 0, camera.getScene().useRightHandedSystem ? -1 : 1));
    const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push(() => node.removeEventListener(type, fn, options));
    };
    function aim() {
        const position = new Vector3(target.x + Math.cos(elevation) * Math.sin(azimuth) * distance,
            target.y + Math.sin(elevation) * distance, target.z + Math.cos(elevation) * Math.cos(azimuth) * distance);
        if (camera.setPosition) { camera.setTarget(target); camera.setPosition(position); }
        else { camera.position.copyFrom(position); camera.setTarget(target); }
        camera.computeWorldMatrix(); camera.getScene().updateTransformMatrix(true); changed();
    }
    function restore(pose) {
        target = v(pose.target);
        const offset = v(pose.position).subtract(target);
        distance = offset.length(); azimuth = Math.atan2(offset.x, offset.z);
        elevation = Math.asin(clamp(offset.y / (distance || 1), -1, 1)); aim();
    }
    const lift = () => {
        const locked = drag?.locked;
        drag = press = context = null; held = false; canvas.style.cursor = 'var(--scene-cursor)';
        if (locked && doc?.pointerLockElement === canvas) doc.exitPointerLock();
    }, release = () => { keys.clear(); lift(); };
    listen(canvas, 'contextmenu', e => e.preventDefault());
    listen(canvas, 'pointerdown', e => {
        if (!enabled()) return;
        canvas.setPointerCapture(e.pointerId);
        held = e.button === 2;
        press = e.button === 0 ? [e.clientX, e.clientY] : null;
        context = e.button === 2 ? [e.clientX, e.clientY] : null;
        const mode = e.button === 0 && !e.shiftKey ? 'orbit' : e.button <= 2 ? 'pan' : '';
        drag = mode && {mode, x: e.clientX, y: e.clientY, travel: 0, lockable: !tool() && !(e.detail > 1)};
        if (drag) canvas.style.cursor = 'none';
    });
    listen(canvas, 'pointermove', e => {
        if (!drag || !enabled()) return;
        // Windows Chrome can report a warp-sized entry spike; discard the first relative sample.
        if (drag.skip) { drag.skip = false; return; }
        const dx = drag.locked ? e.movementX : e.clientX - drag.x;
        const dy = drag.locked ? e.movementY : e.clientY - drag.y, h = canvas.clientHeight || 1;
        drag.x = e.clientX; drag.y = e.clientY; drag.travel += Math.hypot(dx, dy);
        if (drag.lockable && drag.travel > 6 && !drag.attempted && !requesting && canvas.requestPointerLock) {
            drag.attempted = true;
            const pending = requesting = drag;
            const refused = () => { if (requesting === pending) requesting = null; };
            try { canvas.requestPointerLock()?.then(() => {
                if (pending !== drag && doc.pointerLockElement === canvas) doc.exitPointerLock();
            }, refused); } catch { refused(); }
        }
        if (!dx && !dy) return;
        if (drag.mode === 'orbit') {
            const turn = 2 / Math.max(canvas.clientWidth, h, 512);
            // World azimuth projects in the opposite horizontal direction in LH scenes.
            azimuth -= turn * dx * (camera.getScene().useRightHandedSystem ? 1 : -1);
            elevation = clamp(elevation + turn * dy, -1.55, 1.55);
        } else {
            const unit = 2 * distance * Math.tan(camera.fov / 2) / h;
            target.addInPlace(right().scale(-dx * unit)).addInPlace(up().scale(dy * unit));
        }
        aim();
    });
    listen(canvas, 'pointerup', e => {
        const p = press, c = context, moved = drag?.travel || 0;
        lift();
        if (!enabled()) return;
        if (e.button === 2 && c && moved <= 3 && Math.hypot(e.clientX - c[0], e.clientY - c[1]) <= 3)
            menu(e.clientX, e.clientY);
        if (e.button === 0 && p && moved <= 6 && Math.hypot(e.clientX - p[0], e.clientY - p[1]) <= 6)
            click(e.clientX, e.clientY);
    });
    listen(canvas, 'pointercancel', lift);
    listen(canvas, 'lostpointercapture', () => {
        if (!drag || (!drag.locked && requesting !== drag && doc?.pointerLockElement !== canvas)) lift();
    });
    if (doc) {
        listen(doc, 'pointerlockerror', () => requesting = null);
        listen(doc, 'pointerlockchange', () => {
            if (doc.pointerLockElement === canvas && requesting) {
                const pending = requesting; requesting = null;
                if (pending === drag && enabled()) { drag.locked = true; drag.skip = true; }
                else doc.exitPointerLock();
            } else if (drag?.locked) release();
        });
    }
    listen(window, 'blur', release);
    listen(canvas, 'wheel', e => {
        if (!enabled()) return;
        e.preventDefault();
        distance = Math.max(camera.minZ * 4, distance * Math.exp(clamp(e.deltaY, -80, 80) * .001)); aim();
    }, {passive: false});
    listen(canvas, 'dblclick', e => {
        const hit = enabled() && !tool() && surface(e.clientX, e.clientY);
        if (hit) restore({position: camera.position.asArray(), target: hit.pickedPoint.asArray()});
    });
    listen(window, 'keydown', e => {
        if (e.key === 'Escape') { release(); return; }
        if (!enabled() || e.target?.closest?.('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey ||
            e.altKey || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) return;
        if (e.code === 'Space') e.preventDefault(); keys.add(e.code);
    });
    listen(window, 'keyup', e => keys.delete(e.code));
    restore({position: camera.position.asArray(), target: target.asArray()});
    return {restore, release, get distance() { return distance; }, tick(dt) {
        if (!enabled()) { release(); return; }
        const step = Vector3.Zero();
        if (keys.has('KeyW')) step.addInPlace(forward());
        if (keys.has('KeyS')) step.subtractInPlace(forward());
        if (keys.has('KeyD')) step.addInPlace(right());
        if (keys.has('KeyA')) step.subtractInPlace(right());
        if (keys.has('Space')) step.y += held ? -1 : 1;
        if (step.lengthSquared()) { target.addInPlace(step.normalize().scale(speed() * dt)); aim(); }
    }, pose: () => ({position: camera.position.asArray(), target: target.asArray()}), dispose() {
        release(); listeners.forEach(fn => fn());
    }};
}
