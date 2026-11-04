import { createRender } from './bridge.js';
// glTF's playback language is JSON: clip (name or index), from/to seconds and loop.
// It never executes project scripts in the controller origin.
export function localRender(viewer, canvas, controls, pass, resize) {
    let state, info, stop = () => {
    }, pose;
    const surface = createRender({
        setViewport: async () => resize(), setCamera: async (camera) => controls.restore(camera),
        async setIO(patch) {
            Object.assign(state, patch);
            controls.release();
            pass.visible(!state.io_lock);
            canvas.style.pointerEvents = state.io_lock ? 'none' : '';
            info.onInteraction(state);
            return state;
        },
        drawShapes: async (shapes, style) => pass.draw(shapes, style), pick: async (point) => viewer.locate(...point),
        objects: async (shape) => viewer.objects(shape), capture: area => viewer.crop({ shape: 'area', area: area || [0,
          0, 1, 1] }),
        async play(scenario) {
            stop();
            pose ||= controls.pose();
            const script = scenario.script ? JSON.parse(scenario.script) : { clip: scenario.id };
            const clips = viewer.animations(), index = typeof script.clip === 'number' ? script.clip : clips.indexOf(
              script.clip);
            if (!clips.length && script.clip === undefined) return; // Static glTF can hold without an animation.
            const animation = viewer.selectAnimation(index);
            if (!animation)
                throw Error('GLB playback requires a declared animation clip');
            const from = script.from || 0, to = script.to ?? animation.duration, start = performance.now();
            let frame;
            const tick = () => {
                const time = (performance.now() - start) / 1000;
                animation.seek(from + (script.loop ? time % (to - from) : Math.min(time, to - from)));
                surface.emit('time', time);
                if ((script.loop || time < to - from) && (scenario.duration == null || time < scenario.duration))
                    frame = requestAnimationFrame(tick);
            };
            stop = () => cancelAnimationFrame(frame);
            tick();
        },
        async reset() {
            stop();
            await info.reset();
            if (pose)
                controls.restore(pose);
            pose = null;
        }
    });
    return {
        render: surface,
        get interaction() {
            return state;
        },
        async configure(config) {
            info = config;
            state = {
                io_lock: false, configured: true, permissions: config.interaction,
                capabilities: { io_lock: true }
            };
            const ready = {
                renders: [config.render], scenarios: config.scenarios.map(row => row.id), seek: [], controls: ['play',
                  'reset']
            };
            surface.emit('ready', ready);
            return ready;
        },
        command(type, body) {
            if (type === 'alembic.web.interaction')
                return surface.setIO(body);
            if (type === 'alembic.web.play')
                return surface.play({ ...body, id: body.scenario });
            if (type === 'alembic.web.reset')
                return surface.reset();
            throw Error('Unsupported local render command');
        },
        dispose: () => stop()
    };
}
