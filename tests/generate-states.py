"""Generate finite states from both public funnels; no second mock server."""
import json, re
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
render=re.findall(r'^\s{2,}(\w+)\(', (repo/'frontend/src/contract/render.ts').read_text(),re.M)
for type in ('i3d','i2d','audio','iframe'):
    for mode in ('pending','success','slow','failed'):
        name=type+'-'+mode
        replies={'render':{'methods':render,'mode':mode}}
        if mode in ('pending','slow'): replies['services']={'delay':1000 if mode=='pending' else 2500,'body':{'services':[],'vms':['local']}}
        if mode=='failed': replies['services']={'status':503,'body':{'error':'Recorded peer failure'}}
        node='sample.'+type;fmt={'i3d':'babylon','i2d':'html2d','audio':'webaudio','iframe':'app'}[type]
        tree={node+'/.node.txt':json.dumps(dict(format='alembic.node',version=1,entry='index.html',dependencies={})),node+'/exports.txt':'exports-index\t1\nrender\tapp\t'+fmt+'\tindex.html\ninteraction\tapp\tio_lock\ttrue\n',node+'/playbacks.txt':'playbacks-index\t2\n',node+'/index.html':'<!doctype html><canvas width="400" height="240"></canvas>'}
        value=dict(name=name,tree=tree,replies=replies,terminal=['mock-session-ready'],steps=[{'kind':'render','operation':'reset'},{'kind':'backend','operation':'services','status':503 if mode=='failed' else 200}])
        (repo/'tests/states'/(name+'.json')).write_text(json.dumps(value,separators=(',',':'))+'\n')
