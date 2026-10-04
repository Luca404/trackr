#!/usr/bin/env python3
"""Read aggregate integrity/security counts; never prints credentials or user records."""
from pathlib import Path
import json
import os
import shlex
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
os.chdir(root)
project='nitbisweytddtigoebeh'
result=subprocess.run(['supabase','db','dump','--linked','--dry-run'],capture_output=True,text=True)
if result.returncode:
    sys.exit('Unable to obtain CLI connection settings; output withheld to protect credentials.')
tokens=shlex.split(result.stdout)
names=('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE')
settings={t.split('=',1)[0]:t.split('=',1)[1] for t in tokens if any(t.startswith(n+'=') for n in names)}
if set(settings)!=set(names):
    sys.exit('Unsupported CLI connection format; no connection attempted.')
if not settings['PGHOST'].endswith(('.supabase.co','.supabase.com')) or not(project in settings['PGHOST'] or project in settings['PGUSER']):
    sys.exit('Refusing a connection outside the expected shared Supabase project.')
settings['PGSSLMODE']='require'
# Values remain in the process environment. Arguments/logs contain only variable names.
cmd=['docker','exec','-i']
for name in settings: cmd+=['-e',name]
cmd+=['supabase_db_trackr','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-f','-']
query=subprocess.run(cmd,input=(root/'scripts/verify-db-security.sql').read_text(),env={**os.environ,**settings},capture_output=True,text=True)
if query.returncode:
    categories = ('password authentication failed', 'could not translate host name',
                  'connection refused', 'permission denied', 'does not exist',
                  'syntax error', 'timeout expired', 'could not connect', 'SSL error')
    category = next((c for c in categories if c in query.stderr), 'unclassified connection/query error')
    sys.exit(f'Read-only verification failed: {category}; raw output withheld.')
report=json.loads(query.stdout.strip())
print(json.dumps(report,indent=2))
(root/'docs/security-audit-2026-10-04/remote-integrity-fixed.json').write_text(json.dumps(report,indent=2)+'\n')
