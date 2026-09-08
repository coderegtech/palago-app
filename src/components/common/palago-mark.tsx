import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * The PalaGo badge — palm, sunset, coach and road inside a deep-green circle.
 *
 * Drawn as vector rather than shipped as a bitmap so it stays sharp from a
 * 20px header down-scale up to the splash screen, and adds no image decode to
 * first paint.
 *
 * This is the same artwork as `assets/brand/palago-icon.svg`, which is the
 * source the app icons are rasterised from. Change one, change the other, then
 * re-run `node scripts/generate-icons.mjs`.
 */
export function PalaGoMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="PalaGo">
      <Defs>
        <ClipPath id="badge">
          <Circle cx="256" cy="256" r="248" />
        </ClipPath>
        <LinearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFC820" />
          <Stop offset="1" stopColor="#F5A417" />
        </LinearGradient>
        <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3FDCD0" />
          <Stop offset="1" stopColor="#1FBEB4" />
        </LinearGradient>
        <LinearGradient id="hill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7ACB77" />
          <Stop offset="1" stopColor="#3EA45C" />
        </LinearGradient>
        <LinearGradient id="ground" x1="0.15" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor="#0E6B3A" />
          <Stop offset="1" stopColor="#08512B" />
        </LinearGradient>
        <LinearGradient id="coach" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#33B45F" />
          <Stop offset="1" stopColor="#1B8C45" />
        </LinearGradient>
      </Defs>

      <G clipPath="url(#badge)">
        <Rect x="0" y="0" width="512" height="512" fill="url(#ground)" />
        <Circle cx="336" cy="176" r="184" fill="url(#sun)" />

        <Path d="M300 296 q52 -74 104 -30 q30 26 62 20 l46 -10 v40 H300 Z" fill="url(#hill)" />
        <Path d="M392 292 q34 -46 72 -22 l48 30 v20 H392 Z" fill="#5FBA69" opacity={0.85} />

        <Path d="M300 316 H512 v104 H300 Z" fill="url(#sea)" />
        <G fill="#FFFFFF" opacity={0.55}>
          <Rect x="330" y="342" width="58" height="7" rx="3.5" />
          <Rect x="410" y="366" width="76" height="7" rx="3.5" />
          <Rect x="346" y="392" width="46" height="7" rx="3.5" />
        </G>

        <Path
          d="M-30 486 q130 -78 268 -86 q92 -6 158 -34 v50 q-70 28 -156 34 q-138 10 -244 82 Z"
          fill="#FFFFFF"
          opacity={0.94}
        />
        <Path
          d="M-10 508 q128 -64 262 -72 q88 -6 152 -32"
          fill="none"
          stroke="#0E6B3A"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray="26 30"
          opacity={0.3}
        />

        {/*
          `transform` rather than the translateX/translateY props: those are
          native-only and react-native-svg forwards them straight to the DOM on
          web, where React rejects them as unknown attributes.
        */}
        <G transform="translate(150 268)">
          <Rect x="0" y="18" width="264" height="112" rx="30" fill="#FFFFFF" />
          <Path
            d="M18 46 h150 v40 H18 a10 10 0 0 1 -10 -10 v-20 a10 10 0 0 1 10 -10 Z"
            fill="url(#coach)"
          />
          <Path
            d="M0 104 h264 v14 a24 24 0 0 1 -24 24 H24 a24 24 0 0 1 -24 -24 Z"
            fill="url(#coach)"
          />
          <Rect x="0" y="96" width="264" height="12" fill="#F5B800" />
          <Path d="M196 30 h30 a34 34 0 0 1 30 22 l6 18 h-66 Z" fill="#0E6B3A" opacity={0.9} />
          <G fill="#0E6B3A" opacity={0.28}>
            <Rect x="30" y="34" width="42" height="30" rx="8" />
            <Rect x="82" y="34" width="42" height="30" rx="8" />
            <Rect x="134" y="34" width="42" height="30" rx="8" />
          </G>
          <Rect x="232" y="112" width="26" height="12" rx="6" fill="#F5B800" />
          <Circle cx="64" cy="140" r="24" fill="#0B5D33" />
          <Circle cx="64" cy="140" r="10" fill="#FFFFFF" />
          <Circle cx="206" cy="140" r="24" fill="#0B5D33" />
          <Circle cx="206" cy="140" r="10" fill="#FFFFFF" />
        </G>

        <G transform="translate(96 92)">
          <Path d="M74 26 q-14 96 -46 190 q-6 18 14 22 q16 4 20 -16 q22 -104 40 -192 Z" fill="#0B5D33" />
          <G fill="#1C9A4C">
            <Path d="M78 30 q-72 -34 -108 12 q44 -18 72 4 q-46 4 -66 40 q40 -30 84 -22 Z" />
            <Path d="M84 24 q-24 -76 -92 -78 q42 26 46 62 q-30 -32 -74 -26 q52 12 74 54 Z" />
            <Path d="M88 26 q34 -70 106 -56 q-46 8 -62 42 q34 -22 74 -6 q-56 2 -86 40 Z" />
            <Path d="M92 34 q64 -20 96 30 q-40 -24 -74 -8 q40 10 56 48 q-38 -42 -84 -46 Z" />
          </G>
          <Path
            d="M82 28 q-6 -54 44 -78 q-26 32 -22 62 q22 -30 62 -30 q-48 18 -62 54 Z"
            fill="#0E7A3C"
          />
          <Circle cx="82" cy="30" r="11" fill="#0B5D33" />
        </G>

        <G fill="none" stroke="#0B5D33" strokeWidth={9} strokeLinecap="round">
          <Path d="M356 122 q16 -16 32 0" />
          <Path d="M392 96 q14 -14 28 0" />
          <Path d="M404 146 q13 -13 26 0" />
        </G>
      </G>
    </Svg>
  );
}
