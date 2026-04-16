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
  mode: 'crop' | 'fill';
  mirror?: boolean;
  customOffset?: { x: number; y: number };
  customScale?: number;
}

export const RESIZE_FORMATS: ResizeFormat[] = [
  {
    id: 'banner',
    name: 'Bannière large',
    width: 1920,
    height: 480,
    focus: 'center',
    description: 'Format panoramique pour les en-têtes de site.',
    mode: 'crop',
  },
  {
    id: 'focus-center',
    name: 'Focus Centre',
    width: 1600,
    height: 707,
    focus: 'center',
    description: 'Format large avec mise au point sur le milieu.',
    mode: 'crop',
  },
  {
    id: 'focus-left',
    name: 'Focus Gauche',
    width: 1600,
    height: 707,
    focus: 'left',
    description: 'Format large avec mise au point sur le bord gauche.',
    mode: 'crop',
  },
  {
    id: 'square',
    name: 'Carré',
    width: 400,
    height: 400,
    focus: 'center',
    description: 'Format carré idéal pour les réseaux sociaux ou vignettes.',
    mode: 'crop',
  },
  {
    id: 'standard',
    name: 'Format Standard',
    width: 620,
    height: 436,
    focus: 'center',
    description: 'Format classique pour les articles ou fiches produits.',
    mode: 'crop',
  },
];
