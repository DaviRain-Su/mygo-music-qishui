#!/usr/bin/env python3
"""Package a plugin; native manifests use the complete native build entry."""
import argparse
import json
import pathlib
import shutil
import stat
import subprocess
import zipfile


def native_manifest(root):
    manifest = json.loads((pathlib.Path(root) / 'plugin.json').read_text())
    programs = manifest.get('permissions', {}).get('process', [])
    return isinstance(programs, list) and any(
        isinstance(program, str) and program.startswith('bin/qishui-helper-') for program in programs
    )


def package_files(root):
    paths = [root / name for name in ('plugin.json', 'index.js', 'README.md')]
    for folder in ('helper', 'locales'):
        directory = root / folder
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f'{folder} must be a real directory')
        for file in sorted(directory.iterdir()):
            allowed = file.suffix == '.json' if folder == 'locales' else (
                file.suffix in ('.cjs', '.js', '.html') or file.name in ('package.json', 'package-lock.json')
            )
            if allowed and not file.name.startswith('.'):
                paths.append(file)
    # Include only known documentation directories; never walk arbitrary data trees.
    for directory in (root / 'docs', root / 'docs/auth-sdk', root / 'docs/features'):
        if directory.is_symlink():
            raise ValueError('Documentation directory cannot be a symlink')
        if directory.is_dir():
            paths.extend(sorted(directory.glob('*.md')))
    for file in paths:
        if file.is_symlink() or not file.is_file():
            raise ValueError(f'Not a regular code file: {file.relative_to(root)}')
        if file.stat().st_size > 2 * 1024 * 1024:
            raise ValueError(f'Unexpectedly large code file: {file.relative_to(root)}')
    return paths


def build_package(root, output):
    root, output = pathlib.Path(root).resolve(), pathlib.Path(output).absolute()
    if native_manifest(root):
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Native packaging needs Node on the development machine; no Node is needed to run the plugin.')
        subprocess.run([node, str(root / 'scripts/package.mjs'), '--output', str(output)], cwd=root, check=True)
        with zipfile.ZipFile(output) as archive:
            for name in ('bin/qishui-helper-darwin-arm64', 'runtime/native/qishui-sign', 'runtime/native/bdms.node', 'runtime/native/libMetaSecML.dylib'):
                if ((archive.getinfo(name).external_attr >> 16) & 0o111) == 0:
                    raise ValueError(f'Missing executable native component: {name}')
            return len(archive.infolist())
    files = package_files(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for file in files:
                info = zipfile.ZipInfo(file.relative_to(root).as_posix())
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, file.read_bytes())
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    version = json.loads((args.source / 'plugin.json').read_text())['version']
    native = native_manifest(args.source)
    suffix = '-darwin-arm64' if native else ''
    output = args.output or args.source / '.dist' / f'plugin-qishui-{version}{suffix}.zip'
    count = build_package(args.source, output)
    kind = 'complete native runtime' if native else 'legacy code-only package'
    print(f'{output}: {count} files, {output.stat().st_size} bytes; {kind}')


if __name__ == '__main__':
    main()
