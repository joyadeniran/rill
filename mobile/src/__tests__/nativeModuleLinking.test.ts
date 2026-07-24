import fs from 'fs';
import path from 'path';

/**
 * Regression guard for the blank/crashing APK.
 *
 * `expo` pulls expo-asset, expo-constants, expo-font, expo-keep-awake and
 * expo-file-system in as transitive dependencies. npm was placing them at
 * node_modules/expo/node_modules/<name> (nested) instead of hoisting them to
 * the top level — and expo-modules-autolinking only discovers TOP-LEVEL
 * modules. The result: they were never compiled into the APK, and at launch
 * the app died with:
 *
 *   Error: Cannot find native module 'ExpoAsset'
 *   Invariant Violation: "main" has not been registered.
 *
 * i.e. a completely blank screen. They are now declared as explicit direct
 * dependencies in package.json to force top-level placement. This test fails
 * if anything un-hoists them again.
 */

const REQUIRED_TOP_LEVEL_MODULES = [
  'expo-asset',
  'expo-constants',
  'expo-file-system',
  'expo-font',
  'expo-image-picker',
  'expo-keep-awake'
];

const projectRoot = path.resolve(__dirname, '../..');

describe('native module linking (blank-screen regression guard)', () => {
  it.each(REQUIRED_TOP_LEVEL_MODULES)(
    '%s is hoisted to top-level node_modules so autolinking can find it',
    (moduleName) => {
      const topLevel = path.join(projectRoot, 'node_modules', moduleName);
      expect(fs.existsSync(topLevel)).toBe(true);
    }
  );

  it.each(REQUIRED_TOP_LEVEL_MODULES)(
    '%s is declared as a direct dependency (what keeps it hoisted)',
    (moduleName) => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
      ) as { dependencies: Record<string, string> };
      expect(pkg.dependencies[moduleName]).toBeDefined();
    }
  );
});
