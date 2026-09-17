import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RoomieHub',
    short_name: 'RoomieHub',
    id: '/',
    scope: '/',
    start_url: '/homes',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#ddefe4',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
