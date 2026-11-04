import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNotice} from '../frontend/src/render.js';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
test('render handoffs accept completed renderable paths and reject arbitrary files or escapes', () => {
  const notice = {version:1,id:'export-1',path:'godot/build/index.html'};
  assert.deepEqual(renderNotice(bytes(notice)),{id:notice.id,path:notice.path});
  assert.deepEqual(renderNotice(bytes({...notice,path:'Castle.canvas'})),{id:notice.id,path:'Castle.canvas'});
  for(const path of ['/outside.glb','../castle.glb','.alembic/secret.png','godot/../index.html','a\\b.glb','source/build.py','https://example.com/index.html'])
    assert.equal(renderNotice(bytes({...notice,path})),null,path);
  for(const value of [null,{}, {...notice,version:2},{...notice,id:''},{...notice,id:2}]) assert.equal(renderNotice(bytes(value)),null);
  assert.equal(renderNotice(new TextEncoder().encode('{')),null);
});
