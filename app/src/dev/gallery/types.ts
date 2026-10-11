import type { ComponentType } from 'react';

/** One group of components in the ComponentGallery. Each PR that adds components adds one of these. */
export interface GallerySection {
  id: string;
  title: string;
  Component: ComponentType;
}
