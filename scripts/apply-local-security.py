#!/usr/bin/env python3
"""Apply the audited Trackr fixes to the local container, with a private backup."""
from pathlib import Path
from datetime import datetime, timezone
import os
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
os.chdir(root)
container = 'supabase_db_trackr'
env = (root / '.env.local').read_text()
local_urls = {'http://127.0.0.1:54321', 'http://localhost:54321'}
configured_urls = [line.split('=', 1)[1].strip().strip(chr(34)).strip(chr(39)).rstrip('/') for line in env.splitlines() if line.startswith('VITE_SUPABASE_URL=')]
if len(configured_urls) != 1 or configured_urls[0] not in local_urls:
    sys.exit('Refusing: the frontend is not configured for the expected local Supabase.')
paths = sorted((root / 'supabase/migrations').glob('2026100417*.sql'))
paths.insert(0, root / 'supabase/migrations/20261004165900_finance_main_alignment.sql')
if len(paths) != 7:
    sys.exit('Refusing: expected exactly seven reviewed security migrations.')
check = subprocess.run(['docker','exec',container,'psql','-X','-U','postgres','-d','postgres','-Atc',
                        "SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20261004165900'"],check=True,capture_output=True,text=True)
if check.stdout.strip():
    sys.exit('Refusing: local security migrations already exist; do not replay them.')
backup = Path('/tmp') / ('trackr-local-before-security-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.dump')
with backup.open('xb') as output:
    os.chmod(backup, 0o600)
    subprocess.run(['docker','exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom'],stdout=output,check=True)
print('Private local backup:', backup, flush=True)
quote = lambda value: "'" + value.replace("'", "''") + "'"
statements = []
for path in paths:
    version, name = path.stem.split('_',1)
    source = path.read_text()
    statements.append(source)
    statements.append('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (' + quote(version) + ',' + quote(name) + ',ARRAY[' + quote(source) + ']);')
subprocess.run(['docker','exec','-i',container,'psql','-X','--single-transaction','-f','-','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
               input='\n'.join(statements),text=True,check=True)
print('Local schema aligned; all seven migrations recorded in one transaction.')
