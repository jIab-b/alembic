"""Private Windows-to-WSL handoff over stdout; never log the returned URL."""
import argparse,hashlib,http.client,json,os,pathlib,re,sys
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import linux_backend
from project_discovery import discover_projects

def connect(project):
 project,identity,pin,config=linux_backend.project_config(project)
 matches=[r for r in discover_projects() if r['id']==identity]
 if len(matches)!=1 or matches[0]['ambiguous'] or pathlib.Path(matches[0]['path'])!=project:raise RuntimeError('Selected project identity is ambiguous or absent from discovery')
 opened=linux_backend.run(project,'open',True)
 import launcher
 running=launcher.existing_vault()
 if not running or running[0]['vault'].rsplit('+',1)[-1]!=pin:raise RuntimeError('Running Elixir Vault does not match selected project release')
 version,vms=running;rows=[v for v in vms if v['workspace']==identity]
 if len(rows)!=1:raise RuntimeError('Selected project must have exactly one ready VM')
 vm=rows[0];agents=opened['agents'];port=launcher.controller_port(version)
 if not port:raise RuntimeError('Controller listener unavailable')
 origin=f'http://127.0.0.1:{port}';token=(pathlib.Path(version['store'])/'token').read_text().strip()
 def get(path):
  c=http.client.HTTPConnection('127.0.0.1',port,timeout=15);c.request('GET',path,headers={'Authorization':'Bearer '+token});r=c.getresponse();data=r.read();c.close()
  if r.status!=200:raise RuntimeError(f'Installed controller {path.split("?")[0]} returned HTTP {r.status}')
  return data
 public=json.loads(get('/version'));workspaces=json.loads(get('/workspaces'));status=json.loads(get('/vms/'+vm['id']+'/status'));tree=json.loads(get('/w/'+identity+'/tree?at=live'))
 if public['vault']!=version['vault'] or status['status']!='ready' or not any(w['id']==identity and w['path']==str(project) for w in workspaces):raise RuntimeError('Authenticated installed project readiness mismatch')
 html=get('/').decode();asset=re.search(r'src="([^"]+\.js)"',html)
 if not asset:raise RuntimeError('Installed frontend script unavailable')
 asset_path=asset.group(1);asset_hash=hashlib.sha256(get(asset_path)).hexdigest()
 preview=launcher.project_preview(origin,identity)
 from urllib.parse import urlencode
 url=origin+'/#'+urlencode(dict(node=origin,token=token,workspace=identity,vm=vm['id'],agents=','.join(agents),preview=preview))
 proof={'backend':'linux-elixir','vault':version['vault'],'origin':origin,'project':{'id':identity,'path':str(project),'name':matches[0]['name']},'vm':vm['id'],'checks':{'workspaceListed':True,'vmVerified':True,'rootTreeListed':True},'frontend':{'script':asset_path,'sha256':asset_hash},'node_views':[{'name':e['name'],'kind':e['kind']} for e in tree['entries'] if e['name'].endswith(('.i3d','.i2d','.audio','.canvas','.stream'))]}
 return {'url':url,'preview_origin':preview,'proof':proof}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--project',required=True);a=p.parse_args()
 try:print(json.dumps(connect(a.project)),flush=True)
 except Exception as e:print(json.dumps({'error':str(e)}),file=sys.stderr);sys.exit(1)
