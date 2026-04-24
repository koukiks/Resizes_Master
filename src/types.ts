import React from 'react';

export interface SelectionArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeFormat {
  id: string;
  name: string;
  width: number;
  height: number;
  focus: 'center' | 'left';
  description: string;
  mode: 'crop';
  mirror?: boolean;
  customOffset?: { x: number; y: number };
  customScale?: number;
  overlay?: {
    type: 'custom';
    style: React.CSSProperties;
  };
}

export const RESIZE_FORMATS: ResizeFormat[] = [
  {
    id: 'banner',
    name: 'Wide Banner',
    width: 1920,
    height: 480,
    focus: 'center',
    description: 'Panoramic format for website headers.',
    mode: 'crop',
  },
  {
    id: 'focus-center',
    name: 'Focus Center',
    width: 1600,
    height: 707,
    focus: 'center',
    description: 'Wide format with focus on the middle.',
    mode: 'crop',
  },
  {
    id: 'focus-left',
    name: 'Focus Left',
    width: 1600,
    height: 707,
    focus: 'left',
    description: 'Wide format with focus on the left edge.',
    mode: 'crop',
    overlay: {
      type: 'custom',
      style: {
        top: '10%',
        bottom: '10%',
        right: '10%',
        width: '35%',
        backgroundColor: 'rgba(239, 68, 68, 0.3)'
      }
    }
  },
  {
    id: 'square',
    name: 'Square',
    width: 400,
    height: 400,
    focus: 'center',
    description: 'Square format ideal for social media or thumbnails.',
    mode: 'crop',
    overlay: {
      type: 'custom',
      style: {
        bottom: 0,
        left: 0,
        right: 0,
        height: '30%',
        backgroundColor: 'rgba(239, 68, 68, 0.3)'
      }
    }
  },
  {
    id: 'standard',
    name: 'Standard Format',
    width: 620,
    height: 436,
    focus: 'center',
    description: 'Classic format for articles or product sheets.',
    mode: 'crop',
    overlay: {
      type: 'custom',
      style: {
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(66% - 60px)',
        backgroundColor: 'rgba(239, 68, 68, 0.3)'
      }
    }
  },
  {
    id: 'banner-530',
    name: 'Wide Header',
    width: 1920,
    height: 530,
    focus: 'center',
    description: 'Extended panoramic format for website headers.',
    mode: 'crop',
  },
  {
    id: 'square-600',
    name: 'Large Square',
    width: 600,
    height: 600,
    focus: 'center',
    description: 'Large square format for multi-purpose use.',
    mode: 'crop',
  },
];
