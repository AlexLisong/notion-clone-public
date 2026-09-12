#!/usr/bin/env python3
"""Package only Next standalone output and public assets, never private state."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parents[2]
standalone = root / '.next/standalone'
assert (standalone / 'server.js').is_file(), 'Run npm run build:aws first'
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
name = f'folio-{stamp}'
destination = root / '.data/aws' / f'{name}.tar.gz'
destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
with tempfile.TemporaryDirectory(prefix='folio-package-') as temporary:
    stage = Path(temporary) / name
    shutil.copytree(standalone, stage, symlinks=True)
    shutil.copytree(root / '.next/static', stage / '.next/static', dirs_exist_ok=True)
    shutil.copytree(root / 'public', stage / 'public', dirs_exist_ok=True)
    hashes = {}
    for file in sorted(stage.rglob('*')):
        relative = file.relative_to(stage)
        assert not file.is_symlink(), f'Unexpected symlink: {relative}'
        assert not any(part.startswith('.env') or part in {'.data', '.wrangler', '.git'} for part in relative.parts), f'Private path: {relative}'
        assert file.suffix not in {'.sqlite', '.pem'}, f'Private file: {relative}'
        if file.is_file():
            hashes[str(relative)] = hashlib.sha256(file.read_bytes()).hexdigest()
    metadata = {
        'release': name,
        'authVersion': 1,
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'workingTreeChanged': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root)),
        'sha256': hashes,
    }
    (stage / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with tarfile.open(destination, 'w:gz') as archive:
        archive.add(stage, arcname=name)
destination.chmod(0o600)
print(destination)
print('SHA256', hashlib.sha256(destination.read_bytes()).hexdigest())
