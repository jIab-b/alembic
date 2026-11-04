import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { radii } from './document.js';
export const shapeStyle = { color: '#e28a67', alpha: .18 };
export function shapePass(scene, changed = () => {
}) {
    const meshes = [];
    scene.setRenderingAutoClearDepthStencil(3, false);
    function draw(items, style = shapeStyle) {
        const previous = meshes.splice(0);
        for (const item of items.filter(item => item.mode !== 'real')) {
            const sphere = item.shape !== 'box', index = previous.findIndex(m => m.metadata.id === item.id && m.metadata.sphere === sphere);
            const m = index < 0 ? sphere ? CreateSphere('volume', {diameter: 2, segments: 24}, scene) : CreateBox('volume', {size: 1}, scene) : previous.splice(index, 1)[0];
            m.metadata = {id: item.id, sphere};
            m.position.copyFrom(Vector3.FromArray(item.center));
            m.scaling.copyFrom(Vector3.FromArray(sphere ? radii(item) : item.size));
            const mat = m.material || new StandardMaterial('volume', scene);
            mat.emissiveColor = Color3.FromHexString(style.color);
            mat.disableLighting = true;
            mat.alpha = style.alpha;
            mat.disableDepthWrite = true;
            mat.backFaceCulling = false;
            m.material = mat;
            m.isPickable = false;
            m.renderingGroupId = 3;
            meshes.push(m);
        }
        previous.forEach(m => { m.material.dispose(); m.dispose(); });
        changed();
    }
    return {
        draw, meshes, visible(on) {
            meshes.forEach(m => m.setEnabled(on));
            changed();
        }, dispose: () => draw([])
    };
}
