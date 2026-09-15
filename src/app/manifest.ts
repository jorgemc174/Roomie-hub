import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RoomieHub',
    short_name: 'RoomieHub',
    start_url: '/homes',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#ddefe4',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
