const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Tree shaking, for the web export only (`scripts/build-web.mjs` sets the
// flag). It halves what a browser downloads — lucide-react-native alone was
// 1.6 MB of source because every icon shipped — but it is experimental in
// SDK 57 and has not run on a handset, so dev and the Android build keep the
// default module semantics until it has. See docs/performance.md.
if (process.env.EXPO_UNSTABLE_TREE_SHAKING === '1') {
  config.transformer.getTransformOptions = async () => ({
    transform: {
      experimentalImportSupport: true,
      inlineRequires: true,
    },
  });
}

module.exports = withNativeWind(config, { input: './src/global.css' });
