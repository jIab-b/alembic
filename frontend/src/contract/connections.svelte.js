export class Connections {
  rows=$state([]); selected=$state(''); error=$state(''); excluded=$state(new Set());
  key=row=>row.id+':'+row.program?.pid+':'+row.program?.name;
  connected=row=>!this.excluded.has(this.key(row));
  toggle(row){const next=new Set(this.excluded),key=this.key(row);next.has(key)?next.delete(key):next.add(key);this.excluded=next;this.choose()}
  choose(){if(!this.rows.some(r=>r.id===this.selected&&this.connected(r)))this.selected=this.rows.find(this.connected)?.id||''}
  async poll(client,terminal){
    const result=await client.json(client.v('run'),{actor:'terminal-connections'});
    if(result.exit!==0)throw Error('Terminal connection check failed');
    const data=JSON.parse(result.stdout_tail);this.rows=data.rows.filter(r=>r.active&&r.program);this.choose();
      this.error='';
  }
  async send(client,embedded,text){
    const row=this.rows.find(r=>r.id===this.selected&&this.connected(r));if(!row)throw Error('No active session in terminal');
    await client.json(client.v('run'),{actor:'terminal-prompt',session:row.id,text:
      '# '+text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,' ')});
  }
}
