import html2canvas from 'html2canvas-pro';

// Runs inside the app frame: coordinates are relative to its visible viewport.
export async function captureDOM(area, doc = document) {
  if (!Array.isArray(area) || area.length !== 4 || !area.every(Number.isFinite) ||
      area[0] < 0 || area[1] < 0 || area[2] <= 0 || area[3] <= 0 ||
      area[0] + area[2] > 1.000001 || area[1] + area[3] > 1.000001)
    throw new Error('Invalid screenshot area');
  const view = doc.defaultView;
  const [x, y, w, h] = area;
  const width = Math.max(1, w * view.innerWidth), height = Math.max(1, h * view.innerHeight);
  const overlaps = element => {
    const r = element.getBoundingClientRect();
    return r.right > x * view.innerWidth && r.left < (x + w) * view.innerWidth &&
      r.bottom > y * view.innerHeight && r.top < (y + h) * view.innerHeight;
  };
  const inaccessible = [...doc.querySelectorAll('iframe')].filter(overlaps).some(frame => {
    try { return !frame.contentDocument?.documentElement; } catch { return true; }
  });
  const canvas = await html2canvas(doc.documentElement, {
    x: view.scrollX + x * view.innerWidth, y: view.scrollY + y * view.innerHeight,
    width, height, windowWidth: view.innerWidth, windowHeight: view.innerHeight,
    scrollX: view.scrollX, scrollY: view.scrollY,
    scale: Math.min(1, 1024 / Math.max(width, height)),
    backgroundColor: null, logging: false, useCORS: true, allowTaint: false,
    imageTimeout: 2500,
    ignoreElements: element => element.hasAttribute('data-alembic-overlay')
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('HTML screenshot encoding failed');
  return {png: await blob.arrayBuffer(), ...(inaccessible ? {
    warning: 'Selection screenshot omits an inaccessible embedded frame; metadata retained'
  } : {})};
}
