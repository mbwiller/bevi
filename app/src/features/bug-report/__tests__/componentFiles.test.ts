import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { COMPONENT_FILES, DUPLICATE_COMPONENT_FILES, SCREEN_ROUTES } from '../componentFiles.generated';
import { componentFile, isAppComponent } from '../pick';

// The drift guard: no workflow runs scripts/gen-component-files.mjs, so this fails when a component
// was added, renamed or moved and the manifest was not regenerated. Fix: `npm run gen:components -w app`.

const APP_DIR = join(__dirname, '../../../..');
const SCRIPT = join(APP_DIR, 'scripts/gen-component-files.mjs');

interface Built {
  manifest: Record<string, string>;
  duplicates: Record<string, string[]>;
  screens: Record<string, string>;
}

interface Generator {
  OUTPUT: string;
  componentNames(source: string): string[];
  defaultExportName(source: string): string | null;
  isScanned(path: string): boolean;
  isRouteFile(path: string): boolean;
  buildManifest(files: { path: string; source: string }[]): Built;
  render(built: Built): string;
  readFiles(appDir: string): { path: string; source: string }[];
}

/**
 * The generator's own functions, in memory. Jest's Babel transform does not cover .mjs, so the
 * script's source is transpiled to CommonJS here and evaluated; its `main` never runs, because
 * the script only calls it when it is the file node was started with.
 */
function loadGenerator(): Generator {
  const source = readFileSync(SCRIPT, 'utf8')
    .replace(/^#!.*\n/, '')
    .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(SCRIPT).href));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as Generator };
  const run = new Function('require', 'module', 'exports', 'process', outputText) as (
    r: NodeJS.Require,
    m: typeof module,
    e: Generator,
    p: { argv: string[] },
  ) => void;
  run(require, module, module.exports, { argv: [] });
  return module.exports;
}

const generator = loadGenerator();

describe('componentFiles.generated.ts', () => {
  it('is what the generator writes for the source tree as it is now', () => {
    const fresh = generator.render(generator.buildManifest(generator.readFiles(APP_DIR)));
    const committed = readFileSync(join(APP_DIR, '..', generator.OUTPUT), 'utf8');
    // On a failure, run `npm run gen:components -w app` and commit the result.
    expect(committed).toBe(fresh);
  });

  it('knows the components a report is most often about, and where they live', () => {
    expect(COMPONENT_FILES.TabBar).toBe('app/src/components/TabBar.tsx');
    expect(COMPONENT_FILES.BevRow).toBe('app/src/components/BevRow.tsx');
    expect(COMPONENT_FILES.FeedPost).toBe('app/src/components/FeedPost.tsx');
    expect(COMPONENT_FILES.Header).toBe('app/src/components/Header.tsx');
    expect(SCREEN_ROUTES.FeedScreen).toBe('app/src/app/(tabs)/feed/index.tsx');
    expect(SCREEN_ROUTES).not.toHaveProperty('TabsLayout');
    for (const [name, files] of Object.entries(DUPLICATE_COMPONENT_FILES)) expect(files[0]).toBe(COMPONENT_FILES[name]);
  });

  it('answers whether a name is an app component', () => {
    expect(isAppComponent('TabBar')).toBe(true);
    expect(componentFile('TabBar')).toBe('app/src/components/TabBar.tsx');
    // React Native, the router and Object.prototype are not the app's.
    for (const name of ['View', 'Pressable', 'ScreenContentWrapper', 'constructor', 'toString', '', null, undefined]) {
      expect(isAppComponent(name)).toBe(false);
    }
    expect(componentFile('constructor')).toBeUndefined();
  });
});

describe('the generator', () => {
  it('finds every way the app writes a component, and nothing else', () => {
    const source = [
      "import { memo } from 'react';",
      'const WRAP = (Platform.OS === "web" ? {} : {}) as TextStyle;',
      'const TABS = [1, 2];',
      'function helper() {}',
      'function useThing() {}',
      'export function Plain({ a }: Props) {',
      '  function Nested() {}',
      '}',
      'export default function Screen() {}',
      'function Local<T>(props: P<T>) {}',
      'export const Memoed = memo(function Memoed() {});',
      'const Forwarded = React.forwardRef<View, Props>(function Forwarded(props, ref) {});',
      'export const Arrow = ({ a }: Props) => null;',
      'const Typed: FC<Props> = (props) => null;',
      'const Bare = props => null;',
    ].join('\n');
    expect(generator.componentNames(source)).toEqual(['Plain', 'Screen', 'Local', 'Memoed', 'Forwarded', 'Arrow', 'Typed', 'Bare']);
  });

  it('scans src/**/*.tsx and skips tests and the test doubles', () => {
    expect(generator.isScanned('src/components/TabBar.tsx')).toBe(true);
    expect(generator.isScanned('src/app/(tabs)/feed/index.tsx')).toBe(true);
    expect(generator.isScanned('src/components/__tests__/TabBar.test.tsx')).toBe(false);
    expect(generator.isScanned('src/components/TabBar.test.tsx')).toBe(false);
    expect(generator.isScanned('src/testing/fakeApi/Harness.tsx')).toBe(false);
    expect(generator.isScanned('src/lib/format.ts')).toBe(false);
    expect(generator.isScanned('scripts/Thing.tsx')).toBe(false);
  });

  it('prefers components/ over features/ over app/ on a duplicate name, in a fixed order', () => {
    const files = [
      { path: 'src/app/bev/[id].tsx', source: 'export default function BevDetailScreen() {}\nfunction Row() {}\nfunction Only() {}' },
      { path: 'src/features/lists/Row.tsx', source: 'export function Row() {}\nfunction Chip() {}' },
      { path: 'src/features/feed/Chip.tsx', source: 'export function Chip() {}' },
      { path: 'src/components/Row.tsx', source: 'export function Row() {}' },
      { path: 'src/components/__tests__/Row.test.tsx', source: 'function Harness() {}' },
    ];
    const built = generator.buildManifest(files);
    expect(built.manifest).toEqual({
      BevDetailScreen: 'app/src/app/bev/[id].tsx',
      Chip: 'app/src/features/feed/Chip.tsx',
      Only: 'app/src/app/bev/[id].tsx',
      Row: 'app/src/components/Row.tsx',
    });
    expect(Object.keys(built.manifest)).toEqual(['BevDetailScreen', 'Chip', 'Only', 'Row']);
    expect(built.duplicates).toEqual({
      Chip: ['app/src/features/feed/Chip.tsx', 'app/src/features/lists/Row.tsx'],
      Row: ['app/src/components/Row.tsx', 'app/src/features/lists/Row.tsx', 'app/src/app/bev/[id].tsx'],
    });
    // The same files in another order give the same text.
    expect(generator.render(generator.buildManifest([...files].reverse()))).toBe(generator.render(built));
  });

  it('takes the .web file where there is one: the app only ships for the web', () => {
    const built = generator.buildManifest([
      { path: 'src/features/map/MapView.tsx', source: 'export function MapView() {}\nfunction NativeOnly() {}' },
      { path: 'src/features/map/MapView.web.tsx', source: 'export function MapView() {}\nfunction LiveMap() {}' },
    ]);
    expect(built.manifest).toEqual({
      LiveMap: 'app/src/features/map/MapView.web.tsx',
      MapView: 'app/src/features/map/MapView.web.tsx',
    });
    expect(built.duplicates).toEqual({});
  });

  it("names each route's screen, wherever the component lives, and no layout", () => {
    expect(generator.defaultExportName('export default function ListsScreen() {}')).toBe('ListsScreen');
    expect(generator.defaultExportName("import { FeedScreen } from '@/features/feed/FeedScreen';\n\nexport default FeedScreen;\n")).toBe('FeedScreen');
    expect(generator.defaultExportName('export { MapScreen as default };')).toBe('MapScreen');
    expect(generator.defaultExportName('export const x = 1;')).toBeNull();
    expect(generator.isRouteFile('src/app/(tabs)/feed/index.tsx')).toBe(true);
    expect(generator.isRouteFile('src/app/+not-found.tsx')).toBe(true);
    expect(generator.isRouteFile('src/app/_layout.tsx')).toBe(false);
    expect(generator.isRouteFile('src/app/(tabs)/_layout.tsx')).toBe(false);
    expect(generator.isRouteFile('src/app/+html.tsx')).toBe(false);
    expect(generator.isRouteFile('src/features/feed/FeedScreen.tsx')).toBe(false);

    const built = generator.buildManifest([
      { path: 'src/app/_layout.tsx', source: 'export default function RootLayout() {}' },
      { path: 'src/app/(tabs)/feed/index.tsx', source: "import { FeedScreen } from '@/features/feed/FeedScreen';\nexport default FeedScreen;" },
      { path: 'src/features/feed/FeedScreen.tsx', source: 'export function FeedScreen() {}' },
    ]);
    expect(built.screens).toEqual({ FeedScreen: 'app/src/app/(tabs)/feed/index.tsx' });
    expect(built.manifest.FeedScreen).toBe('app/src/features/feed/FeedScreen.tsx');
    expect(built.manifest.RootLayout).toBe('app/src/app/_layout.tsx');
  });
});
