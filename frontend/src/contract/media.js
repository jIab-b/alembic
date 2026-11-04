import {mediaHTML} from '../../../render/registry.js';
import { checkedHTML, effectScript } from './effect.js';
// Only generated glue is synthetic; authored files and dependencies stay in their node.
export function mediaEntry(node, render, scenarios, exports, background, source) {
    const html = mediaHTML(render);
    const config = { render, scenarios, exports, background, html };
    const entry = html ? new TextDecoder().decode(checkedHTML(source, node)) : '<!doctype html><head>' + effectScript(
      node);
    return new TextEncoder().encode(entry +
        '<script>window.__alMedia=' + JSON.stringify(config).replaceAll('<', '\\u003c') + '</script>' +
        '<script type="module" src="/assets/play/media.js"></script>' + (html ? '' : '</head><body></body>'));
}
