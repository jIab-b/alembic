export const svg = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`);
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGN40ODwHwAGhAKgwePY/gAAAABJRU5ErkJggg==', 'base64');
// One textured triangle, with an embedded PNG: no external assets or codecs required.
export function texturedGLB() {
  const positions = new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]), uv = new Float32Array([0,0,1,0,.5,1]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uv.buffer), png]);
  const padded = Buffer.concat([bin, Buffer.alloc((4-bin.length%4)%4)]);
  const doc = {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'}],
    images:[{bufferView:2,mimeType:'image/png'}],textures:[{source:0}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0}}]};
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const out = Buffer.alloc(12+8+json.length+8+padded.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
  out.writeUInt32LE(padded.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);padded.copy(out,28+json.length);return out;
}
export const project = () => new Map([['note.txt',Buffer.from('BEFORE')],['scene.svg',svg('blue')],['model.glb',texturedGLB()],['preview.png',png]]);
