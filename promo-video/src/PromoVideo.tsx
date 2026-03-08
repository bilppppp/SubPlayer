import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const BG = {
  dark: '#07111d',
  blue: '#2d7ff9',
  cyan: '#22d3ee',
  green: '#34d399',
  text: '#f8fafc',
  muted: '#9ca3af',
};

const FadeInUp: React.FC<{
  delay?: number;
  children: React.ReactNode;
}> = ({delay = 0, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: {damping: 200},
  });
  const opacity = interpolate(enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(enter, [0, 1], [36, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{opacity, transform: `translateY(${translateY}px)`}}>{children}</div>
  );
};

const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = interpolate(frame, [0, fps * 2], [1.08, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 20% 30%, rgba(34,211,238,0.35) 0%, rgba(7,17,29,0.95) 40%), linear-gradient(135deg, #0f172a 0%, #07111d 100%)',
        color: BG.text,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          textAlign: 'center',
          width: 1400,
          maxWidth: '88%',
        }}
      >
        <FadeInUp>
          <div style={{fontSize: 36, letterSpacing: 8, color: BG.cyan}}>SUBPLAYER</div>
        </FadeInUp>
        <FadeInUp delay={12}>
          <h1 style={{fontSize: 116, lineHeight: 1.05, margin: '22px 0'}}>AI 字幕识别与翻译平台</h1>
        </FadeInUp>
        <FadeInUp delay={22}>
          <p style={{fontSize: 42, margin: 0, color: BG.muted}}>
            从视频链接到双语字幕，全流程自动化
          </p>
        </FadeInUp>
      </div>
    </AbsoluteFill>
  );
};

const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const features = [
    '支持本地文件与 URL 输入',
    'YouTube / Bilibili / 通用网页视频',
    '实时字幕 + 播放同步高亮',
    '双语 / 原文 / 译文三种模式',
    '导出 SRT / VTT / TXT / JSON / Markdown',
  ];

  return (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(160deg, rgba(3,7,18,1) 0%, rgba(10,25,47,1) 45%, rgba(15,23,42,1) 100%)',
        padding: '120px 150px',
        color: BG.text,
      }}
    >
      <FadeInUp>
        <h2 style={{fontSize: 82, margin: 0}}>核心能力</h2>
      </FadeInUp>
      <div style={{height: 24}} />
      {features.map((feature, index) => {
        const start = index * 10;
        const visible = interpolate(frame, [start, start + 14], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        return (
          <div
            key={feature}
            style={{
              opacity: visible,
              transform: `translateX(${interpolate(visible, [0, 1], [42, 0])}px)`,
              fontSize: 46,
              marginTop: 26,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <span style={{color: BG.green, fontSize: 56}}>•</span>
            <span>{feature}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const StackScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cards = [
    {title: 'Web UI', value: 'Next.js', color: '#2d7ff9'},
    {title: 'Gateway', value: 'Bun + Hono', color: '#22d3ee'},
    {title: 'ASR', value: 'FunASR / Volcengine / Bailian', color: '#34d399'},
    {title: 'Translate', value: 'Gemini / Qwen / DeepSeek', color: '#60a5fa'},
    {title: 'Extension', value: 'Chrome Workflow', color: '#14b8a6'},
  ];

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(120deg, #07111d 0%, #111827 50%, #021b2f 100%)',
        padding: '100px 120px',
        color: BG.text,
      }}
    >
      <FadeInUp>
        <h2 style={{fontSize: 78, margin: 0}}>技术架构</h2>
      </FadeInUp>
      <div
        style={{
          marginTop: 42,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 26,
        }}
      >
        {cards.map((card, index) => {
          const enter = spring({
            frame: frame - index * 8,
            fps: 30,
            config: {stiffness: 120},
          });

          return (
            <div
              key={card.title}
              style={{
                opacity: enter,
                transform: `translateY(${interpolate(enter, [0, 1], [36, 0])}px)`,
                borderRadius: 24,
                padding: '34px 30px',
                background: 'rgba(15,23,42,0.72)',
                border: `2px solid ${card.color}`,
                boxShadow: `0 8px 24px ${card.color}33`,
              }}
            >
              <div style={{fontSize: 34, color: card.color, marginBottom: 10}}>{card.title}</div>
              <div style={{fontSize: 30, lineHeight: 1.3}}>{card.value}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(Math.sin(frame / 12), [-1, 1], [0.92, 1.04]);

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 50% 20%, rgba(45,127,249,0.32) 0%, rgba(7,17,29,1) 55%)',
        color: BG.text,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{textAlign: 'center'}}>
        <FadeInUp>
          <h2 style={{fontSize: 92, margin: 0}}>SubPlayer</h2>
        </FadeInUp>
        <FadeInUp delay={10}>
          <p style={{fontSize: 42, margin: '18px 0 0', color: BG.muted}}>
            让每一段视频都可检索、可翻译、可复用
          </p>
        </FadeInUp>
        <FadeInUp delay={18}>
          <div
            style={{
              marginTop: 54,
              display: 'inline-block',
              padding: '20px 36px',
              fontSize: 34,
              borderRadius: 999,
              background: BG.blue,
              transform: `scale(${pulse})`,
              boxShadow: `0 12px 36px ${BG.blue}99`,
            }}
          >
            开始体验 • localhost:3000
          </div>
        </FadeInUp>
      </div>
    </AbsoluteFill>
  );
};

export const PromoVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={90}>
        <TitleScene />
      </Sequence>
      <Sequence from={90} durationInFrames={120}>
        <FeaturesScene />
      </Sequence>
      <Sequence from={210} durationInFrames={120}>
        <StackScene />
      </Sequence>
      <Sequence from={330} durationInFrames={90}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
};
