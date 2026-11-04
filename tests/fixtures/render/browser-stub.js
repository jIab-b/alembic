import {bindRender} from '../html/runtime.js';
import {createRender} from '../bridge.js';
if (document.documentElement.dataset.broken) createRender({}, 'i2d');
else {
  document.body.style.background = '#527cac';
  await bindRender({scenarios: ['color'],
    play: () => {document.body.style.background = '#c85b4a';},
    reset: () => {document.body.style.background = '#527cac';}
  });
}
