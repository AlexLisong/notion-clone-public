#!/usr/bin/env python3
"""Check application and database without logging credentials or workspace data."""
import json
import os
import pwd
import sqlite3
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit

values = dict(line.split('=', 1) for line in Path('/etc/folio/runtime.env').read_text().splitlines() if '=' in line)
if os.geteuid() == 0:
    account = pwd.getpwnam('folio')
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
with sqlite3.connect('file:/var/lib/folio/workspace.sqlite?mode=ro', uri=True) as db:
    team = bool(db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='team_meta'").fetchone() and db.execute('SELECT id FROM team_meta WHERE id=1').fetchone())
    if team:
        assert db.execute("SELECT count(*) FROM team_users WHERE role='owner' AND disabled=0").fetchone()[0] == 1
endpoint = '/api/team/session' if team or values.get('FOLIO_TEAM_AUTH') == '1' else '/api/workspace'
request = urllib.request.Request('http://127.0.0.1:4320' + endpoint, headers={
    'Host': urlsplit(values['FOLIO_PUBLIC_ORIGIN']).netloc,
    'X-Forwarded-Proto': 'https',
    'X-Folio-Proxy-Key': values['FOLIO_PROXY_KEY'],
})
with urllib.request.urlopen(request, timeout=10) as response:
    body = json.load(response)
if endpoint.endswith('/session'):
    assert body['enabled'] is True and body['user'] is None
else:
    assert isinstance(body['revision'], int) and body['workspace']['version'] == 1
print('Folio database health OK')
