import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { useMemo } from 'react';
import { chunkWords } from './captions';
import type { Card, Label, Scene, ShortProps } from './types';

const DISPLAY = "'Montserrat', 'Liberation Sans', sans-serif";
const UI = "'Inter', 'Liberation Sans', sans-serif";
const FADE = 8;
/** Font size so the longest word fits the frame width (Montserrat Black, uppercase ≈ 0.74em per glyph). */
const fit = (words: string[], max: number, width = 640) => Math.min(max, Math.floor(width / (Math.max(4, ...words.map((w) => w.length)) * 0.74)));
const HOOK_SECONDS = 2.6;

export const Short: React.FC<ShortProps> = (props) => {
  const { fps } = useVideoConfig();
  const story = props.template === 'story';
  const chunks = useMemo(() => chunkWords(props.words, props.template === 'explainer' ? 2 : story ? 4 : 3), [props.words, props.template]);
  const { durationInFrames } = useVideoConfig();
  const hookEnd = props.hookText ? Math.min(HOOK_SECONDS, props.scenes[0]?.end ?? HOOK_SECONDS) : 0;
  const dark = props.template === 'cards';
  return (
    <AbsoluteFill style={{ background: dark ? '#090b1a' : '#0d1b24', fontFamily: UI }}>
      {dark && <CardsBackdrop />}
      {props.scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const dur = Math.max(1, Math.round((s.end - s.start) * fps)) + (i < props.scenes.length - 1 ? FADE : 0);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            <SceneView scene={s} index={i} total={props.scenes.length} template={props.template} mainName={props.mainName || ''} />
          </Sequence>
        );
      })}
      {props.hookText && (
        <Sequence from={0} durationInFrames={Math.round(hookEnd * fps)} layout="none">
          <Hook text={props.hookText} dark={dark} />
        </Sequence>
      )}
      {chunks.filter((c) => c.end > hookEnd).map((c, i) => {
        const from = Math.round(Math.max(c.start, hookEnd) * fps);
        const dur = Math.max(2, Math.round(c.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            {story ? <StoryCaption words={c.words} highlight={c.highlight} /> : <Caption words={c.words} highlight={c.highlight} color={c.color} dark={dark} />}
          </Sequence>
        );
      })}
      {props.partLabel && <Sequence from={0} durationInFrames={Math.round(fps * 3.5)} layout="none"><PartBadge text={props.partLabel} /></Sequence>}
      {props.endLabel && <Sequence from={Math.max(0, durationInFrames - Math.round(fps * 2))} layout="none"><EndCard text={props.endLabel} /></Sequence>}
      {props.audio && <Audio src={props.audio} />}
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- scenes */

const SceneView: React.FC<{ scene: Scene; index: number; total: number; template: ShortProps['template']; mainName: string }> = ({ scene, index, total, template, mainName }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const opacity = index === 0 ? 1 : interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: 'clamp' });
  if (template === 'cards') {
    return (
      <AbsoluteFill style={{ opacity }}>
        <TabStrip index={index} total={total} />
        <AbsoluteFill style={{ top: 300, bottom: 300, left: 44, right: 44, position: 'absolute' }}>
          {scene.card.kind !== 'none' ? <CardView card={scene.card} image={scene.image} /> : scene.image ? <FramedImage src={scene.image} /> : null}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (template === 'story' && (scene.card.kind === 'chat' || scene.card.kind === 'phone')) {
    return (
      <AbsoluteFill style={{ opacity }}>
        {scene.image ? <Img src={scene.image} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(6px) brightness(0.55)', transform: 'scale(1.1)' }} />
          : <AbsoluteFill style={{ background: 'repeating-linear-gradient(90deg, #c98d4f 0 38px, #bd8247 38px 76px)' }} />}
        <PhoneView card={scene.card} mainName={mainName} />
      </AbsoluteFill>
    );
  }
  // Explainer / story: slow push-in / drift, alternating direction per scene.
  const p = frame / Math.max(1, durationInFrames);
  const zoom = 1.06 + 0.1 * Easing.inOut(Easing.ease)(Math.min(1, p));
  const dx = (index % 2 ? -1 : 1) * 18 * p;
  const dy = (index % 3 === 0 ? -1 : 1) * 10 * p;
  return (
    <AbsoluteFill style={{ opacity }}>
      {scene.image ? (
        <Img src={scene.image} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom}) translate(${dx}px, ${dy}px)` }} />
      ) : (
        <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 30%, #1f4f5e 0%, #0d1b24 70%)' }} />
      )}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%)' }} />
      {template !== 'story' && scene.labels.slice(0, 3).map((l, i) => <Pointer key={i} label={l} delay={Math.round(fps * 0.4) + i * 8} />)}
      {template !== 'story' && scene.card.kind !== 'none' && (
        <div style={{ position: 'absolute', left: 48, right: 48, top: 170 }}>
          <CardView card={scene.card} image={null} compact />
        </div>
      )}
    </AbsoluteFill>
  );
};

const Pointer: React.FC<{ label: Label; delay: number }> = ({ label, delay }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const x = Math.min(0.9, Math.max(0.1, label.x)) * width;
  const y = Math.min(0.85, Math.max(0.15, label.y)) * height;
  const text = label.text.toUpperCase().slice(0, 28);
  const w = text.length * 15 + 30;
  const left = x > width / 2;
  const tx = Math.max(16, Math.min(width - w - 16, left ? x - w - 40 : x + 40));
  // Keep pointer labels out of the caption band (58%-72% of the height) and the hook area.
  let ty = Math.max(120, y - 90);
  if (ty + 44 > height * 0.56 && ty < height * 0.74) ty = y < height * 0.65 ? height * 0.56 - 50 : height * 0.74;
  return (
    <>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <line x1={x} y1={y} x2={left ? tx + w : tx} y2={ty + 22} stroke="#fff" strokeWidth={3} strokeDasharray="200" strokeDashoffset={200 - 200 * s} />
        <circle cx={x} cy={y} r={7 * s} fill="#fff" />
      </svg>
      <div style={{ position: 'absolute', left: tx, top: ty, transform: `scale(${s})`, transformOrigin: left ? 'right center' : 'left center', padding: '8px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.94)', color: '#14202a', font: `800 22px ${DISPLAY}`, letterSpacing: 0.5, whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(0,0,0,0.3)' }}>
        {text}
      </div>
    </>
  );
};

/* ---------------------------------------------------------------- captions & hook */

const Caption: React.FC<{ words: string[]; highlight: number; color: string; dark: boolean }> = ({ words, highlight, color, dark }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 220 }, durationInFrames: 8 });
  const scale = interpolate(pop, [0, 1], [0.7, 1]);
  if (dark) {
    return (
      <div style={{ position: 'absolute', top: 170, left: 40, right: 40, textAlign: 'center', transform: `scale(${scale})`, font: `700 ${Math.min(52, Math.floor(640 / (Math.max(...words.map((w) => w.length), 6) * 0.6)))}px ${UI}`, color: '#fff', textShadow: '0 4px 18px rgba(0,0,0,0.6)' }}>
        {words.map((w, i) => <span key={i} style={{ color: i === highlight ? '#FF8A4C' : '#fff', fontStyle: i === highlight ? 'italic' : 'normal' }}>{w}{' '}</span>)}
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', top: '58%', left: 30, right: 30, textAlign: 'center', transform: `scale(${scale})` }}>
      <span style={{ font: `900 ${fit(words, 76)}px/1.05 ${DISPLAY}`, textTransform: 'uppercase', letterSpacing: 1, WebkitTextStroke: '10px #000', paintOrder: 'stroke fill', textShadow: '0 6px 0 rgba(0,0,0,0.85)' }}>
        {words.map((w, i) => <span key={i} style={{ color: i === highlight ? color : '#fff' }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
      </span>
    </div>
  );
};

const Hook: React.FC<{ text: string; dark: boolean }> = ({ text, dark }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 13 } });
  const words = text.replace(/[“”"]/g, '').split(/\s+/);
  const key = words.reduce((b, w, i) => (w.length > (words[b]?.length ?? 0) ? i : b), 0);
  return (
    <div style={{ position: 'absolute', top: 120, left: 40, right: 40, textAlign: 'center', transform: `translateY(${(1 - s) * -40}px)`, opacity: s }}>
      <span style={{ font: `900 ${fit(words, dark ? 60 : 66)}px/1.1 ${DISPLAY}`, textTransform: 'uppercase', WebkitTextStroke: dark ? '0' : '9px #000', paintOrder: 'stroke fill', color: '#fff', textShadow: '0 5px 0 rgba(0,0,0,0.8)' }}>
        {words.map((w, i) => <span key={i} style={{ color: i === key ? '#FFD23F' : '#fff' }}>{w} </span>)}
      </span>
    </div>
  );
};

/* ---------------------------------------------------------------- cards template */

const CardsBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(90% 55% at 50% ${48 + 4 * Math.sin(frame / 60)}%, rgba(76,52,170,0.38) 0%, rgba(9,11,26,0) 70%), linear-gradient(180deg, #0b0d22 0%, #090b1a 100%)` }} />
  );
};

const TabStrip: React.FC<{ index: number; total: number }> = ({ index, total }) => (
  <div style={{ position: 'absolute', top: 262, left: 44, right: 44, display: 'flex', gap: 10 }}>
    {Array.from({ length: Math.min(total, 6) }, (_, i) => (
      <div key={i} style={{ flex: 1, height: 30, borderRadius: 8, border: `2px solid ${i === index % 6 ? '#FF7A45' : 'rgba(255,255,255,0.12)'}`, background: i === index % 6 ? 'rgba(255,122,69,0.15)' : 'rgba(255,255,255,0.04)', color: '#cfd3ff', font: `600 15px ${UI}`, display: 'grid', placeItems: 'center' }}>#{i + 1}</div>
    ))}
  </div>
);

const panel: React.CSSProperties = { borderRadius: 22, border: '2px solid rgba(255,122,69,0.55)', background: 'linear-gradient(180deg, rgba(40,22,30,0.92), rgba(22,14,26,0.96))', boxShadow: '0 0 40px rgba(255,122,69,0.18), inset 0 1px 0 rgba(255,255,255,0.06)', color: '#fff', padding: 30 };

const CardView: React.FC<{ card: Card; image: string | null; compact?: boolean }> = ({ card, image, compact }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  const style: React.CSSProperties = { ...panel, transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter, ...(compact ? { padding: 22, background: 'rgba(12,16,30,0.82)' } : {}) };
  return (
    <div style={style}>
      <div style={{ font: `700 ${compact ? 26 : 30}px ${UI}`, marginBottom: 18, color: '#FFB08A' }}>{card.heading}</div>
      {card.kind === 'stat' && <Counter value={card.value} />}
      {(card.kind === 'list' || card.kind === 'steps') && card.items.slice(0, 6).map((it, i) => <ListRow key={i} i={i} text={it} on={i === card.highlight} numbered={card.kind === 'steps'} />)}
      {card.kind === 'compare' && (
        <div style={{ display: 'flex', gap: 16 }}>
          {card.items.slice(0, 2).map((it, i) => (
            <div key={i} style={{ flex: 1, padding: 20, borderRadius: 16, background: i === Math.max(0, card.highlight) ? 'rgba(92,230,92,0.14)' : 'rgba(255,90,95,0.12)', border: `2px solid ${i === Math.max(0, card.highlight) ? '#5CE65C' : '#FF5A5F'}`, font: `700 28px/1.3 ${UI}`, opacity: interpolate(frame, [8 + i * 8, 16 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{it}</div>
          ))}
        </div>
      )}
      {card.kind === 'quote' && <div style={{ font: `600 italic 36px/1.35 ${UI}` }}>“{card.items[0] || card.heading}”</div>}
      {image && <Img src={image} style={{ marginTop: 20, width: '100%', height: 380, objectFit: 'cover', borderRadius: 16 }} />}
    </div>
  );
};

const ListRow: React.FC<{ i: number; text: string; on: boolean; numbered: boolean }> = ({ i, text, on, numbered }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 6 - i * 5, fps, config: { damping: 15 } });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', marginBottom: 12, borderRadius: 14, background: on ? 'rgba(255,122,69,0.18)' : 'rgba(255,255,255,0.05)', border: `2px solid ${on ? '#FF7A45' : 'transparent'}`, transform: `translateX(${(1 - s) * 80}px)`, opacity: s }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', font: `700 20px ${UI}`, color: '#cfd3ff' }}>{numbered ? i + 1 : '•'}</span>
      <span style={{ font: `600 28px/1.25 ${UI}` }}>{text}</span>
    </div>
  );
};

const Counter: React.FC<{ value: string }> = ({ value }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const target = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(target) || String(value).trim() === '') return <div style={{ font: `800 92px ${UI}` }}>{value}</div>;
  const k = interpolate(frame, [4, fps * 1.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const shown = Math.round(target * k).toLocaleString('id-ID');
  return <div style={{ font: `800 ${shown.length > 10 ? 70 : 96}px ${UI}`, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{shown}</div>;
};

const FramedImage: React.FC<{ src: string }> = ({ src }) => (
  <div style={{ ...panel, padding: 14 }}><Img src={src} style={{ width: '100%', height: 560, objectFit: 'cover', borderRadius: 14 }} /></div>
);

/* ---------------------------------------------------------------- story template */

const StoryCaption: React.FC<{ words: string[]; highlight: number }> = ({ words, highlight }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', top: '71%', left: 36, right: 36, textAlign: 'center', opacity: o }}>
      <span style={{ font: `800 ${Math.min(44, Math.floor(640 / (Math.max(10, words.join(' ').length) * 0.52)))}px/1.2 ${UI}`, color: '#fff', WebkitTextStroke: '6px rgba(0,0,0,0.85)', paintOrder: 'stroke fill', textShadow: '0 3px 10px rgba(0,0,0,0.5)' }}>
        {words.map((w, i) => <span key={i} style={{ color: i === highlight ? '#FFC93C' : '#fff' }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
      </span>
    </div>
  );
};

const PartBadge: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <div style={{ position: 'absolute', top: 70, right: 40, transform: `scale(${s})`, opacity: out, padding: '10px 22px', borderRadius: 999, background: '#16120c', border: '3px solid #FFC93C', color: '#FFC93C', font: `900 34px ${DISPLAY}`, letterSpacing: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>{text}</div>
  );
};

const EndCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ background: `rgba(10,8,6,${0.72 * s})`, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${0.8 + 0.2 * s})`, opacity: s, textAlign: 'center', color: '#fff', font: `900 58px/1.15 ${DISPLAY}`, textTransform: 'uppercase', padding: '0 50px' }}>
        <span style={{ color: '#FFC93C' }}>{text.split(' ')[0]}</span> {text.split(' ').slice(1).join(' ')}
      </div>
    </AbsoluteFill>
  );
};

const PhoneView: React.FC<{ card: Card; mainName: string }> = ({ card, mainName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16 } });
  const isChat = card.kind === 'chat';
  const msgs = card.items.slice(0, 7).map((m) => { const i = m.indexOf(':'); return i > 0 ? { who: m.slice(0, i).trim(), text: m.slice(i + 1).trim() } : { who: '', text: m }; });
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, top: 150, height: 760, transform: `translateY(${(1 - s) * 120}px) rotate(-4deg)`, opacity: s, borderRadius: 46, background: '#111', padding: 16, boxShadow: '0 30px 60px rgba(0,0,0,0.5)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 34, overflow: 'hidden', background: isChat ? '#ece5dd' : '#f4f6fb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: isChat ? '#1f7a5c' : '#1e4fd8', color: '#fff', padding: '22px 22px 16px', font: `700 24px ${UI}` }}>{card.heading || (isChat ? 'Chat' : 'Notifikasi')}</div>
        {isChat ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msgs.map((m, i) => {
              const mine = Boolean(m.who) && /^(aku|saya|me)$/i.test(m.who) || (Boolean(mainName) && m.who.toLowerCase() === mainName.toLowerCase());
              const show = interpolate(frame, [6 + i * 10, 12 + i * 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return (
                <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', opacity: show, transform: `translateY(${(1 - show) * 12}px)`, background: mine ? '#d9fdd3' : '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: '0 1px 1px rgba(0,0,0,0.12)' }}>
                  {m.who && <div style={{ font: `700 16px ${UI}`, color: '#1f7a5c', marginBottom: 2 }}>{m.who}</div>}
                  <div style={{ font: `500 21px/1.3 ${UI}`, color: '#111' }}>{m.text}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: 22, display: 'grid', gap: 14 }}>
            {card.value && <div style={{ font: `800 ${String(card.value).length > 12 ? 44 : 56}px ${UI}`, color: card.value.trim().startsWith('-') ? '#d62c2c' : '#111' }}>{card.value}</div>}
            {card.items.slice(0, 6).map((it, i) => (
              <div key={i} style={{ opacity: interpolate(frame, [8 + i * 8, 14 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), padding: '12px 14px', borderRadius: 12, background: '#fff', font: `500 20px/1.3 ${UI}`, color: '#222', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>{it}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
