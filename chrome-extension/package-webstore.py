#!/usr/bin/env python3
"""Build a Web Store ZIP without changing the unpacked manifest or extension ID."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(destination, version=None):
    source = Path(__file__).resolve().parent
    manifest = json.loads((source / 'manifest.json').read_text())
    manifest.pop('key', None)
    store = json.loads((source / 'webstore-config.json').read_text())
    if not re.fullmatch(r'[a-p]{32}', store['extension_id']):
        raise ValueError('Invalid Store extension ID')
    if not re.fullmatch(r'[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com', store['oauth_client_id']):
        raise ValueError('Invalid public Store OAuth client ID')
    manifest['oauth2']['client_id'] = store['oauth_client_id']
    if version is not None:
        if not re.fullmatch(r'(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4})){0,3}', version) or any(int(part) > 65535 for part in version.split('.')) or not any(int(part) for part in version.split('.')):
            raise ValueError('Invalid extension version')
        manifest['version'] = version
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob('*')):
            relative = path.relative_to(source)
            if not path.is_file() or any(part.startswith('.') for part in relative.parts):
                continue
            if path.name.endswith('.test.js'):
                continue
            if path.name == 'manifest.json':
                archive.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
            elif path.suffix in {'.js', '.html', '.css', '.png'}:
                archive.write(path, relative)
    with ZipFile(destination) as archive:
        assert archive.testzip() is None, 'ZIP integrity check failed'
        assert 'key' not in json.loads(archive.read('manifest.json'))
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', help='Destination ZIP path')
    parser.add_argument('--version', help='Store package version, if different from the unpacked source')
    args = parser.parse_args()
    print(package(args.output, args.version))
