// Follow the selected session; a file name changes before the outgoing iframe detaches.
export async function renderFrame(page, previous='') {
  await page.waitForFunction(previous=>{
    const frame=document.querySelector('.viewport iframe');
    return frame && frame.src!==previous && frame.style.visibility==='visible' &&
      new URLSearchParams(new URL(frame.src).hash.slice(1)).has('session');
  },previous);
  const src=await page.locator('.viewport iframe').getAttribute('src');
  const session=new URLSearchParams(new URL(src).hash.slice(1)).get('session');
  return page.frames().find(frame=>frame.url().includes('/app/'+session+'/')) ||
    page.waitForEvent('framenavigated',{predicate:frame=>frame.url().includes('/app/'+session+'/')});
}
