/** Upload an image instead of pasting its address (00272): what goes up, and how much. */

export const IMAGE_UPLOAD_BUCKET = 'content-images';
/** The bucket's own limit: 5 MB a file. */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** The types the bucket takes, with the extension each is saved under. */
export const IMAGE_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** On the managed cloud, an organization's uploads a day (the bucket is public). */
export const IMAGE_UPLOADS_PER_DAY = 100;

/** The extension a type is saved under, or null for one the bucket doesn't take. */
export const imageUploadExtension = (type: string): string | null =>
  Object.hasOwn(IMAGE_UPLOAD_TYPES, type) ? IMAGE_UPLOAD_TYPES[type] : null;
