// Limits on images in comments, shared by the browser and the server.

/** Per image. Hosts behind a proxy or adapter-node must allow request bodies this large. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 6;
/** No SVG: it can carry script. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
