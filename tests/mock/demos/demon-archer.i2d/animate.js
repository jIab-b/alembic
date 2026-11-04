// Playback body. write-playbacks.py prefixes the scenario's `shooting` flag.
// No timers, SMIL, CSS animation or motion run before the host calls Play.
const get = id => media.querySelector('#' + id);
const ids = ['breathing', 'mantle', 'crown-fire', 'ground-light', 'draw-arm',
  'draw-bracer', 'draw-hand', 'bow-limb', 'bow-edge', 'bow-string', 'arrow',
  'arrow-fire', 'flight-trail', 'trail-ribbon', 'trail-flames', 'trail-core',
  'release-flash', 'release-ring', 'shot-sparks'];
const nodes = Object.fromEntries(ids.map(id => [id, get(id)]));
const embers = [...get('embers').children];
const sparks = [...nodes['shot-sparks'].children];
const changed = [...Object.values(nodes), ...embers, ...sparks];
const original = changed.map(node => [node, [...node.attributes].map(a => [a.name, a.value])]);
const set = (id, key, value) => nodes[id].setAttribute(key, String(value));
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const release = 2.65;
let frame, disposed = false;
const start = performance.now();
function pose(t) {
  const breath = Math.sin(t * Math.PI * 2 / 4);
  const draw = shooting ? smooth((t - .5) / 1.65) * (1 - smooth((t - release) / .18)) : 0;
  const since = t - release;
  const recoil = shooting && since >= 0 ? Math.sin(since * 29) * Math.exp(-since * 9) : 0;
  set('breathing', 'transform', `translate(${-draw * 3 + recoil * 3} ${-breath * 2})`);
  set('mantle', 'transform', `rotate(${breath * 1.2 - draw * 1.5} 430 335)`);
  set('crown-fire', 'transform', `translate(451 300) scale(${1 + Math.sin(t * 9) * .025} ${1 + Math.sin(t * 13) * .035}) translate(-451 -300)`);
  set('crown-fire', 'opacity', .85 + Math.sin(t * 8) * .1);
  set('ground-light', 'opacity', .2 + Math.sin(t * 3) * .035 + draw * .07);
  const nock = 638 - 136 * draw;
  set('bow-string', 'd', `M639 181L${nock + recoil * 15} 350 637 520`);
  const limb = `M639 181C${707 + draw * 9} 215 ${697 + draw * 12} 279 662 338L660 362C${699 + draw * 12} 425 ${695 + draw * 9} 479 637 520`;
  set('bow-limb', 'd', limb);
  set('bow-edge', 'd', limb);
  const elbow = 449 - draw * 60;
  set('draw-arm', 'd', `M447 356Q429 353 ${elbow - 25} 376L${elbow} 394 ${nock} 357 ${nock - 3} 344 ${elbow + 1} 374 465 363z`);
  set('draw-bracer', 'd', `M${nock - 55} 355l40-8 5 16-39 10z`);
  set('draw-hand', 'transform', `translate(${nock} 350)`);
  const fired = shooting && since >= 0;
  const arrowX = fired ? 502 + since * 1080 + since * since * 150 : nock;
  const reload = shooting ? smooth((t - 5.25) / .6) : 1;
  set('arrow', 'transform', `translate(${arrowX} 350)`);
  set('arrow', 'opacity', fired ? (since < 1 ? 1 : 0) : 1);
  // Quietly re-nock after the projectile has left the frame.
  if (shooting && t > 5.25) {
    set('arrow', 'transform', 'translate(638 350)');
    set('arrow', 'opacity', reload);
  }
  set('arrow-fire', 'transform', `translate(198 0) scale(${1 + Math.sin(t * 17) * .08 + draw * .3} ${1 + Math.sin(t * 21) * .12 + draw * .3}) translate(-198 0)`);
  // Fire stays along the flight path after the arrow leaves the frame.
  const tail = 662;
  const tip = Math.min(1340, Math.max(tail, arrowX + 185));
  const burn = fired ? 1 - smooth((since - .7) / 1.4) : 0;
  const rise = fired ? Math.max(0, since - .65) * 12 : 0;
  const y = 350 - rise;
  set('flight-trail', 'opacity', fired ? Math.min(1, since * 28) * burn : 0);
  set('trail-ribbon', 'd', `M${tail} ${y}Q${(tail + tip) / 2} ${y - 19} ${tip} ${y - 2}L${tip} ${y + 3}Q${(tail + tip) / 2} ${y + 14} ${tail} ${y}z`);
  set('trail-core', 'd', `M${tail} ${y}Q${(tail + tip) / 2} ${y + Math.sin(t * 18) * 3} ${tip} ${y}`);
  const tongues = [];
  for (let x = tail + 18, i = 0; x < tip - 12; x += 31, i++) {
    const flicker = .7 + Math.sin(t * 23 + i * 2.4) * .3;
    const height = (12 + (i * 7 % 19)) * flicker * (.45 + burn * .55);
    const side = i % 3 === 0 ? 1 : -1;
    tongues.push(`M${x - 12} ${y}Q${x - 1} ${y + side * height * .3} ${x - 7} ${y + side * height}Q${x + 16} ${y + side * height * .55} ${x + 13} ${y}Z`);
  }
  set('trail-flames', 'd', tongues.join(' ') || 'M0 0');
  // The white-hot burst and expanding ring share the exact string-release time.
  set('release-flash', 'opacity', fired ? Math.pow(Math.max(0, 1 - since / .55), 1.4) : 0);
  set('release-ring', 'r', 14 + Math.max(0, since) * 170);
  set('release-ring', 'opacity', fired ? Math.max(0, 1 - since / .5) : 0);
  embers.forEach((ember, i) => {
    const phase = (t * (19 + i % 4 * 6) + i * 19) % 150;
    ember.setAttribute('transform', `translate(${Math.sin(t * 1.5 + i * 2) * 9} ${-phase})`);
    ember.setAttribute('opacity', Math.sin(phase / 150 * Math.PI) * .8);
  });
  set('shot-sparks', 'opacity', fired && since < 1.45 ? Math.max(0, 1 - since / 1.45) : 0);
  sparks.forEach((spark, i) => {
    const age = Math.max(0, since - i * .018);
    spark.setAttribute('cx', 675 + age * (390 + i * 38));
    spark.setAttribute('cy', 350 + Math.sin(i * 9) * age * 95 + age * age * 48);
  });
}
function tick(now) {
  if (disposed) return;
  const t = (now - start) / 1000;
  pose(Math.min(t, shooting ? 6.4 : 8));
  if (t < (shooting ? 6.4 : 8)) frame = requestAnimationFrame(tick);
}
pose(0);
frame = requestAnimationFrame(tick);
return () => {
  disposed = true;
  cancelAnimationFrame(frame);
  for (const [node, attributes] of original) {
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [key, value] of attributes) node.setAttribute(key, value);
  }
};
