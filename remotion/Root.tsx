import { Composition, continueRender, delayRender } from 'remotion';
import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import { Short } from './Short';
import { DEMO, type ShortProps } from './types';

// Make sure the bundled fonts are ready before the first frame is captured.
if (typeof document !== 'undefined') {
  const handle = delayRender('fonts');
  document.fonts.ready.then(() => continueRender(handle));
}

export const Root: React.FC = () => (
  <Composition
    id="Short"
    component={Short as unknown as React.FC<Record<string, unknown>>}
    defaultProps={DEMO as unknown as Record<string, unknown>}
    width={720}
    height={1280}
    fps={30}
    durationInFrames={240}
    calculateMetadata={({ props }) => {
      const p = props as unknown as ShortProps;
      return { durationInFrames: Math.max(30, Math.ceil(p.duration * p.fps)), fps: p.fps, width: p.width, height: p.height };
    }}
  />
);
