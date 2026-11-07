import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

script = pathlib.Path(__file__).parents[1] / 'scripts' / 'package.py'
spec = importlib.util.spec_from_file_location('qishui_package', script)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        for name in ['index.js', 'plugin.json', 'README.md', 'helper/launch.cjs', 'helper/package.json', 'helper/package-lock.json', 'locales/zh-CN.json']:
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text('{"id":"qishui","version":"0.2.1"}' if name == 'plugin.json' else '{}')

    def test_dependency_tree_and_credentials_never_enter_archive(self):
        noisy = self.root / 'helper/node_modules/electron/dist/Electron.app/Contents/Frameworks'
        noisy.mkdir(parents=True)
        (noisy / 'framework-link').symlink_to('elsewhere')
        (noisy / 'binary').write_bytes(b'large runtime fixture')
        secret = self.root / 'helper/auth-sdk'
        secret.mkdir()
        (secret / 'storage.json').write_text('sessionid=do-not-package')
        output = self.root / '.dist/plugin.zip'
        package.build_package(self.root, output)
        with zipfile.ZipFile(output) as archive:
            names = archive.namelist()
            self.assertIn('plugin.json', names)
            self.assertIn('helper/launch.cjs', names)
            self.assertFalse(any('node_modules' in n or 'auth-sdk' in n for n in names))
            self.assertFalse(any((f.external_attr >> 16) & 0o170000 == 0o120000 for f in archive.infolist()))

    def test_symlinked_allowed_file_is_rejected_not_dereferenced(self):
        file = self.root / 'helper/launch.cjs'
        file.unlink()
        file.symlink_to(self.root / 'README.md')
        with self.assertRaises(ValueError):
            package.build_package(self.root, self.root / '.dist/plugin.zip')

    def test_helper_directory_itself_cannot_be_a_symlink(self):
        helper = self.root / 'helper'
        helper.rename(self.root / 'external')
        helper.symlink_to(self.root / 'external', target_is_directory=True)
        with self.assertRaises(ValueError):
            package.build_package(self.root, self.root / '.dist/plugin.zip')


if __name__ == '__main__':
    unittest.main()
