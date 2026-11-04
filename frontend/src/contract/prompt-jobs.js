// Extend the existing canvas snapshots; pending receipts survive deletion of either UI element.
export async function promptJobs(folder, client, complete, schedule, failed) {
  const records = new Map(); let timer, work = Promise.resolve(), stopped = false;
  const newest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
  const queue = task => work = work.catch(() => {}).then(task);
  async function write(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
    await folder.write(`.alembic/canvases/${data.canvasId}.json`, bytes);
    await folder.write('.alembic/selection.json', bytes);
  }
  const arm = () => {
    if (stopped || ![...records.values()].some(data => data.pending?.length)) {
      clearTimeout(timer); timer = undefined;
    } else if (!timer) timer = setTimeout(() => {
      timer = undefined; void schedule(() => queue(check)).catch(failed).finally(arm);
    }, 1000);
  };
  async function check() {
    for (const data of records.values()) for (const job of [...(data.pending || [])]) {
      const path = job.details.replace(/\.json$/, '.done');
      try { if (!job.done) await folder.read(path); }
      catch (error) { if (error.name === 'NotFoundError') continue; throw error; }
      job.done = true;
      data.prompts = (data.prompts || []).map(node => node.request === job.request
        ? {...node, state: 'done', note: '', hidden: true} : node);
      await write(data); // Save completion before acknowledging its receipt, including after a crash.
      complete(data.canvasId, job.request, 'done', '');
      await client.request(client.w('file', {path}), {method: 'DELETE'});
      data.pending = data.pending.filter(value => value !== job);
      await write(data);
    }
  }
  const entries = await folder.entries('.alembic/canvases').catch(error => {
    if (/^404\b/.test(error.message)) return []; throw error;
  });
  for (const entry of entries) {
    if (entry.directory || !/^[\w-]+\.json$/.test(entry.name)) continue;
    try {
      const data = JSON.parse(new TextDecoder().decode(await folder.read('.alembic/canvases/' + entry.name)));
      if (data.version === 1 && data.canvasId === entry.name.slice(0, -5)) records.set(data.canvasId, data);
    } catch { /* The workspace retains its existing corrupt-highlight reader. */ }
  }
  await check(); arm();
  return {
    latest: () => [...records.values()].sort(newest)[0]?.documentPath,
    fail(tab, request, note) { return queue(() => {
      const data = records.get(tab); if (!data) return;
      data.pending = (data.pending || []).filter(job => job.request !== request);
      data.prompts = data.prompts.map(node => node.request === request ? {...node, state: 'fail', note} : node);
      arm(); return write(data);
    }); },
    saved: file => [...records.values()].filter(data => data.file === file)
      .sort(newest)[0],
    save(data, job) { return queue(() => {
      data.pending = [...(records.get(data.canvasId)?.pending || []), ...(job ? [job] : [])];
      records.set(data.canvasId, data); arm(); return write(data);
    }); },
    close() { stopped = true; clearTimeout(timer); }
  };
}
