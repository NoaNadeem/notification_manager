#!/usr/bin/env python3
"""Build a Web Store ZIP without changing the unpacked manifest or extension ID."""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(destination):
    source = Path(__file__).resolve().parent
    manifest = json.loads((source / 'manifest.json').read_text())
    manifest.pop('key', None)
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
    print(package(parser.parse_args().output))
