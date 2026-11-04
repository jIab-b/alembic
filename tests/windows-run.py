"""Invoke the required Windows Chrome harness without printing launch credentials."""
import os, subprocess, sys, uuid
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
def windows(path): return subprocess.check_output(['wslpath','-w',str(Path(path).resolve())],text=True).strip()
def quote(value): return "'"+value.replace("'","''")+"'"
def run(url_file,out,check,extra=None):
    Path(out).mkdir(parents=True,exist_ok=True)
    script='$env:ALEMBIC_URL=[IO.File]::ReadAllText('+quote(windows(url_file))+');'+ '$env:ALEMBIC_OUT='+quote(windows(out))+';'+ '$env:ALEMBIC_CHECK='+quote(windows(repo/'tests/windows-checks.mjs') if check else '')+';'+ "$env:ALEMBIC_PROFILE=Join-Path $env:TEMP 'alembic-ui-"+uuid.uuid4().hex+"';"
    if check: script+='$env:ALEMBIC_CASE='+quote(str(check))+';'
    if os.environ.get('ALEMBIC_DEPS') and not (extra or {}).get('PLAYWRIGHT_MODULE'):
        module=Path(os.environ['ALEMBIC_DEPS'])/'browser-tools/node_modules/playwright'
        script += '$env:PLAYWRIGHT_MODULE='+quote(windows(module))+';'
    for key,value in (extra or {}).items(): script+='$env:'+key+'='+quote(str(value))+';'
    script+="$ready=$false;for($i=0;$i -lt 60;$i++){try{$null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri (([Uri]$env:ALEMBIC_URL).GetLeftPart([UriPartial]::Authority));$ready=$true;break}catch{Start-Sleep -Milliseconds 100}};if(-not $ready){throw 'Windows loopback endpoint did not become ready'};"
    script+='& node '+quote(windows(repo/'tests/ui-check-windows.mjs'))+';exit $LASTEXITCODE'
    return subprocess.run(['powershell.exe','-NoProfile','-Command',script],timeout=int((extra or {}).get('ALEMBIC_TIMEOUT', 200 if check=='skills' else 110)),capture_output=True,text=True)
if __name__=='__main__':
    result=run(*sys.argv[1:4]); print(result.stdout); print(result.stderr,file=sys.stderr); sys.exit(result.returncode)
