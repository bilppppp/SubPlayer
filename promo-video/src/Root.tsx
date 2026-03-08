import React from 'react';
import {Composition} from 'remotion';
import {PromoVideo} from './PromoVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SubPlayerPromo"
      component={PromoVideo}
      durationInFrames={420}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
