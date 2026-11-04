export function readInteraction(value) {
  if(value===undefined)value={};
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.entries(value).some(([key,flag])=>
    key!=='screen_lock' && (key!=='io_lock' || typeof flag!=='boolean')))throw Error('Invalid interaction permissions');
  return {io_lock:Object.hasOwn(value,'io_lock')&&value.io_lock===true};
}

