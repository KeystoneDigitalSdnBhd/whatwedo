"""Run on the computer with Antigravity: python3 install.py [--config PATH]."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import venv

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--config', type=Path, default=Path.home()/'.gemini/config/mcp_config.json')
args = parser.parse_args()
root = Path(__file__).resolve().parent
environment = root/'.venv'
venv.EnvBuilder(with_pip=True).create(environment)
python = environment/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root/'requirements.txt')], check=True)
config = args.config.expanduser().resolve()
data = json.loads(config.read_text()) if config.exists() else {}
servers = data.setdefault('mcpServers', {})
if 'sap-developer' in servers:
    raise SystemExit('sap-developer already exists; review it before changing it. No config modified.')
servers['sap-developer'] = {'command': str(python), 'args': [str(root/'server.py')]}
config.parent.mkdir(parents=True, exist_ok=True)
if config.exists():
    with tempfile.NamedTemporaryFile(prefix=config.name+'.backup-', dir=config.parent, delete=False) as backup:
        backup_path = Path(backup.name)
    shutil.copy2(config, backup_path)
with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=config.parent, delete=False) as output:
    json.dump(data, output, indent=2)
    output.write('\n')
    temporary = output.name
os.replace(temporary, config)
print(f'Added sap-developer to {config}. Reload MCP servers in Antigravity.')
