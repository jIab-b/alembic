// Vault exposes only this terminal's foreground program; the relay returns its PTY list.
const scan=`import json,pathlib,sys
rows=[]
for p in pathlib.Path('/proc').iterdir():
 try:
  if not p.name.isdigit() or b'ALEMBIC_TERMINAL_ID='+sys.argv[1].encode() not in (p/'environ').read_bytes().split(b'\\0'): continue
  f=(p/'stat').read_text().rsplit(')',1)[1].split()
  if f[4]=='0' or f[2]!=f[5] or int(f[5])<=0: continue
  a=(p/'cmdline').read_bytes().decode(errors='replace').split('\\0');n=pathlib.Path(a[0]).name
  if n in ('bash','sh','zsh','fish'): continue
  if n in ('node','nodejs','python','python3'): n=next((pathlib.Path(v).stem for v in a[1:] if v and not v.startswith('-')),n)
  if n=='cli': n=next((v for v in ('claude','codex','opencode') if any(v in x for x in a)),n)
  rows.append(dict(id=sys.argv[1],external=False,active=True,program=dict(pid=int(p.name),name=n)));break
 except (OSError,ValueError,IndexError): pass
print(json.dumps(dict(local=False,rows=rows)))`;
export class Connections {
  rows=$state([]); selected=$state(''); error=$state(''); excluded=$state(new Set()); local=false;
  key=row=>row.id+':'+row.program?.pid+':'+row.program?.name;
  connected=row=>!this.excluded.has(this.key(row));
  toggle(row){const next=new Set(this.excluded),key=this.key(row);next.has(key)?next.delete(key):next.add(key);this.excluded=next;this.choose()}
  choose(){if(!this.rows.some(r=>r.id===this.selected&&this.connected(r)))this.selected=this.rows.find(this.connected)?.id||''}
  async poll(client,terminal){
    const result=await client.json(client.v('run'),{argv:['python3','-I','-c',scan,terminal],actor:'terminal-connections',timeout_s:3});
    if(result.exit!==0)throw Error('Terminal connection check failed');
    const data=JSON.parse(result.stdout_tail);this.local=!!data.local;this.rows=data.rows.filter(r=>r.active&&r.program);this.choose();this.error='';
  }
  async send(client,embedded,text){
    const row=this.rows.find(r=>r.id===this.selected&&this.connected(r));if(!row)throw Error('No active session in terminal');
    if(this.local)await client.json(client.v('run'),{actor:'terminal-prompt',session:row.id,text:'# '+text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,' ')});else await embedded(text);
  }
}
