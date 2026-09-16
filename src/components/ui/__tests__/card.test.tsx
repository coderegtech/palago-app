/**
 * The card is the tap target, and nothing is nested inside it that also wants
 * to be one.
 *
 * NativeWind implements pseudo-classes by upgrading the component: a `View`
 * carrying `:active`, `:hover` or `:focus` styles is swapped for a real
 * `Pressable` so it has somewhere to hang `onPressIn`/`onPressOut`
 * (`react-native-css-interop/dist/runtime/native/render-component.js`).
 *
 * So `<Pressable onPress><Card className="active:bg-…"/></Pressable>` is two
 * nested Pressables on device. The inner one takes the touch responder and the
 * outer `onPress` never fires — the card highlights under a finger and does
 * nothing.
 *
 * None of that happens on web, where `:active` is ordinary CSS and the click
 * bubbles, and none of it happens under Jest either, which renders the web
 * stack. That is precisely why the passenger home's "Search trips" and
 * "Upcoming" cards shipped unusable in the APK while working perfectly
 * everywhere anyone looked.
 *
 * A behavioural test therefore cannot catch this. The second block reads the
 * source instead, which is unusual and is the only thing that would have
 * caught it.
 */

import { render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from '@/components/ui/card';

// `tsconfig.json` sets `types: ["jest"]` deliberately — pulling in Node's
// globals would put `process`, `Buffer` and Node's timer signatures into a
// React Native app's type surface, where they would quietly mask real
// mismatches. This one test needs to read files, so it declares the little it
// uses rather than widening that surface for everything.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(p: string, encoding: string): string;
  readdirSync(p: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

const fs = require('fs');
const path = require('path');

describe('Card', () => {
  it('is a plain surface with no handler', async () => {
    await render(
      <Card>
        <Text>Just a surface</Text>
      </Card>,
    );

    expect(screen.getByText('Just a surface')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes the tap target when given onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();

    await render(
      <Card accessibilityRole="button" accessibilityLabel="Open the thing" onPress={onPress}>
        <Text>Tap me</Text>
      </Card>,
    );

    await user.press(screen.getByLabelText('Open the thing'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('no Card with a pseudo-class style is nested inside a Pressable', () => {
  const root = path.resolve(__dirname, '..', '..', '..');

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory(): boolean }) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
      return entry.name.endsWith('.tsx') ? [full] : [];
    });
  }

  it('anywhere under src/', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(root)) {
      // Strip comments first: this file's own documentation describes the
      // anti-pattern, and a scanner that cannot tell prose from code would
      // flag the explanation of the bug as the bug.
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const match of source.matchAll(/<Pressable\b/g)) {
        const rest = source.slice(match.index);
        const end = rest.indexOf('</Pressable>');
        if (end === -1) continue;
        // A Card inside this Pressable whose className carries a pseudo-class.
        if (/<Card[^>]*className="[^"]*(?:active|hover|focus):/s.test(rest.slice(0, end))) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${path.relative(root, file).replace(/\\/g, '/')}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
