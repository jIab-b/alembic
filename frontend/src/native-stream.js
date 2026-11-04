import {resolveNodePath} from './canvas.js';
export function readInteraction(value) {
  if(value===undefined)value={};
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.entries(value).some(([key,flag])=>
    key!=='screen_lock' && (key!=='io_lock' || typeof flag!=='boolean')))throw Error('Invalid interaction permissions');
  return {io_lock:Object.hasOwn(value,'io_lock')&&value.io_lock===true};
}

export function readNativeStream(bytes, descriptorPath = '') {
  if (bytes.length > 65536) throw new Error('Native view descriptor is too large');
  const spec=JSON.parse(new TextDecoder().decode(bytes));
  const path=value=>typeof value==='string'&&!/[\\\x00-\x1f:]/.test(value)&&value.split('/').every(part=>part&&!part.startsWith('.'));
  if (spec?.sourceBase !== undefined) {
    if (spec.sourceBase !== 'descriptor' || !path(descriptorPath) || !descriptorPath.endsWith('.stream'))
      throw new Error('Descriptor-relative native view requires its project-relative .stream path');
    const base = descriptorPath.split('/').slice(0, -1).join('/');
    spec.source = resolveNodePath(base, spec.source);
    if (Array.isArray(spec.editTargets)) spec.editTargets = spec.editTargets.map(value => resolveNodePath(base, value));
    delete spec.sourceBase;
  }
  const local=value=>{try{const origin=globalThis.location?.origin||'http://127.0.0.1',u=new URL(value,origin);return !u.username&&!u.password&&!u.search&&!u.hash&&((u.origin===origin&&/^\/vms\/[^/]+\/preview\/[^/]+\/?$/.test(u.pathname))||(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port))}catch{return false}};
  if(spec?.format!=='alembic.native-view'||spec.version!==1||!['blender','godot'].includes(spec.application)||
    ((spec.control!==undefined||spec.whep!==undefined)&&(!local(spec.control)||(spec.whep!==undefined&&!local(spec.whep))||(spec.whep===undefined&&spec.transport!=='native-surface')))||
    !Number.isInteger(spec.width)||!Number.isInteger(spec.height)||spec.width<320||spec.width>2560||spec.height<240||spec.height>1600||
    !Number.isInteger(spec.fps)||spec.fps<1||spec.fps>120||(spec.transport!==undefined&&!['webrtc','native-surface'].includes(spec.transport))||
    !path(spec.source)||!(spec.application==='godot'?spec.source.split('/').at(-1)==='project.godot':spec.source.endsWith('.blend'))||
    (spec.editTargets!==undefined&&(!Array.isArray(spec.editTargets)||spec.editTargets.length>128||!spec.editTargets.every(path)))||
    (spec.assembly!==undefined&&(spec.application!=='godot'||!['coastal-weapon','coastal-gameplay'].includes(spec.assembly)))||
    (spec.actions!==undefined&&(!Array.isArray(spec.actions)||spec.actions.length>8||spec.application!=='godot'||
      spec.actions.some(action=>!action||typeof action.label!=='string'||!action.label||action.label.length>32||!['f','r','e','Tab','Return','Shift_L','Control_L'].includes(action.key))||
      new Set(spec.actions.map(action=>action.key)).size!==spec.actions.length))||
    (spec.session!==undefined&&(typeof spec.session!=='string'||!/^[a-f0-9]{32}$/.test(spec.session)))||
    (spec.surface!==undefined&&(!spec.surface||!/^[a-f0-9]{32}$/.test(spec.surface.id)||spec.surface.title!=='Alembic surface '+spec.surface.id))||
    (spec.ticket!==undefined&&(typeof spec.ticket!=='string'||spec.ticket.length<24||spec.ticket.length>4096)))throw new Error('Invalid native view descriptor');
  return {...spec,interaction:readInteraction(spec.interaction)};
}
