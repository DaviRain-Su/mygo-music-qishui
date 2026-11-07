#!/usr/bin/env python3
"""Build a code-only MyGo plugin zip. No npm dependency, SDK or account data is included."""
import argparse
import json
import pathlib
import stat
import zipfile


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
    for directory in (root / 'docs', root / 'docs/auth-sdk'):
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
    output = args.output or args.source / '.dist' / f'plugin-qishui-{version}.zip'
    count = build_package(args.source, output)
    print(f'{output}: {count} code files, {output.stat().st_size} bytes; no runtime dependencies')


if __name__ == '__main__':
    main()
