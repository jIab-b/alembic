(() => {
  const captureURL = new URL('dom-capture.js', document.currentScript.src).href;
  let areas = [], active = '', lightIframe = false;
  addEventListener('keydown', event => {
    if (!lightIframe || !['F3','Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) parent.postMessage({type:'alembic.iframe.key',key:event.key},'*');
  }, true);
  addEventListener('message', async ({data, source}) => {
    if (source !== parent) return;
    if (data?.type === 'alembic.iframe.mode') {lightIframe=true;return;}
    if (data?.type === 'alembic.inspect') {
      try {
        const layer=document.querySelector('[data-alembic-overlay]');
        if(layer)layer.style.pointerEvents='none';
        let found;
        try { found=await under(data.area); }
        finally { if(layer)layer.style.pointerEvents='auto'; }
        if(window.__alEmbedded?.state)found.objects.push({id:'state',name:'State: '+window.__alEmbedded.state});
        parent.postMessage({type: 'alembic.inspected', id: data.id, ...found}, '*', found.png ? [found.png] : []);
      } catch(error) { parent.postMessage({type:'alembic.web.failure',error:String(error.message||error)},location.origin); parent.postMessage({type: 'alembic.inspected', id: data.id, objects: [], png: null}, '*'); }
    } else if (data?.type === 'alembic.areas') { areas = data.areas; active = data.active; }
  });
  addEventListener('pointerdown', () => parent.postMessage({type: 'alembic.dismiss'}, '*'), true);
  addEventListener('contextmenu', event => {
    const x = event.clientX / innerWidth, y = event.clientY / innerHeight;
    const hit = [...areas].reverse().sort((a, b) => Number(b.id === active) - Number(a.id === active))
      .find(({area: [ax, ay, w, h]}) => x >= ax && x <= ax + w && y >= ay && y <= ay + h);
    if (!hit) return;
    event.preventDefault(); event.stopPropagation();
    parent.postMessage({type: 'alembic.area-menu', id: hit.id, x, y}, '*');
  }, true);
  // What an area over the app covers: the topmost element at each point of an 8x8 grid inside it (what the user
  // sees there, as CSS selectors) and an HTML crop. Renderer hooks retain their own pixel capture.
  // Areas are fractions of the app viewport.
  async function under([x, y, w, h]) {
    if (window.alembicCapture) return {objects:[],png:await window.alembicCapture([x,y,w,h])};
    const doc = document, view = window, found = new Set();
    if (!doc || !view) return {objects: []};
    const [width, height] = [view.innerWidth, view.innerHeight];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const element = doc.elementFromPoint((x + w * (i + 0.5) / 8) * width, (y + h * (j + 0.5) / 8) * height);
      if (element && element !== doc.body && element !== doc.documentElement) found.add(element);
    }
    const objects = [...found].slice(0, 24).map(element => ({selector: selector(element), name: describe(element)}));
    try {
      const {captureDOM} = await import(captureURL);
      return {objects, ...await captureDOM([x,y,w,h])};
    } catch (error) {
      return {objects, png: null, warning: 'Selection screenshot unavailable: ' + String(error.message || error) + '; metadata retained'};
    }
  }
  function selector(element) {
    const parts = [];
    for (let at = element; at && at !== at.ownerDocument.body; at = at.parentElement) {
      if (at.id) { parts.unshift(`#${CSS.escape(at.id)}`); break; }
      const same = [...at.parentElement?.children ?? []].filter(other => other.localName === at.localName);
      parts.unshift(same.length > 1 ? `${at.localName}:nth-of-type(${same.indexOf(at) + 1})` : at.localName);
    }
    return parts.join(' > ');
  }
  function describe(element) {
    const text = (element.innerText || element.getAttribute('alt') || element.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    return text ? `${element.localName} "${text.slice(0, 80)}"` : element.localName;
  }


})();
