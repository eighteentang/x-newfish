"""Build the public unpacked-extension ZIP using Python's standard library."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'manifest.json', 'background.js', 'config.js', 'content.js',
    'metrics-core.js', 'filter-core.js', 'tweet-metrics.js', 'x-net-hook.js',
    'account-signals.js', 'account-decorations.js',
    'board-position.js', 'management-core.js', 'data-bridge.js', 'manager-content.js',
    'management.html', 'management.css', 'management.js', 'docs/AI_SCORING.md',
    'options.html', 'options.css', 'options.js',
    'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
    'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'assets/sponsor/wechat.svg', 'assets/sponsor/alipay.svg',
)


def validate():
    for name in FILES:
        if not (ROOT / name).is_file():
            raise ValueError(f'Missing release file: {name}')
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    references = [manifest['background']['service_worker'], manifest['options_page'],
                  manifest['action']['default_popup'], *manifest['icons'].values(),
                  *manifest['action']['default_icon'].values()]
    for entry in manifest['content_scripts']:
        references.extend(entry['js'])
        references.extend(entry.get('css', []))
    for name in FILES:
        text = (ROOT / name).read_text(encoding='utf-8') if name.endswith(('.html', '.css', '.js', '.md')) else ''
        refs = []
        if name.endswith(('.html', '.md')):
            refs += re.findall(r'(?:src|href)=["\']([^"\']+)["\']', text)
        if name.endswith('.js'):
            for arguments in re.findall(r'importScripts\(([^)]+)\)', text):
                refs += re.findall(r'["\']([^"\']+)["\']', arguments)
        if name.endswith('.css'):
            refs += re.findall(r'url\(["\']?([^\s)"\']+)', text)
        for ref in refs:
            if ref.startswith(('#', '//')) or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', ref):
                continue
            references.append(str(PurePosixPath(name).parent / ref.split('?')[0].split('#')[0]))
    missing = sorted(set(references) - set(FILES))
    if missing:
        raise ValueError(f'Referenced files omitted from ZIP: {missing}')
    if f'v{manifest["version"]}' not in (ROOT / 'options.html').read_text(encoding='utf-8'):
        raise ValueError('Popup version differs from manifest version')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    manifest = validate()
    target = args.out.resolve()
    if target.suffix.lower() != '.zip':
        parser.error('--out must be a .zip file')
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation protects any previously published artifact.
    with ZipFile(target, 'x', compression=ZIP_DEFLATED) as archive:
        for name in sorted(FILES):
            item = ZipInfo('x-newfish/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, (ROOT / name).read_bytes())
    with ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
        if len(archive.namelist()) != len(FILES):
            raise ValueError('ZIP file count differs from allowlist')
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    print(json.dumps({'name': manifest['name'], 'version': manifest['version'],
                      'file_count': len(FILES), 'size': target.stat().st_size,
                      'sha256': digest, 'path': str(target)}, indent=2))


if __name__ == '__main__':
    main()
