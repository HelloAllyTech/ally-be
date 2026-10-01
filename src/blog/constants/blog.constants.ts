// S3 key prefix for blog header/body images.
export const BLOG_IMAGE_S3_PREFIX = 'blog';

// Header images can be a little larger than the default 2 MB image cap.
export const BLOG_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Fill shown in place of a header image. Must match the column default in
// migration 1975000000000 and the first swatch in the admin editor's palette.
export const BLOG_DEFAULT_COVER_COLOR = '#8B9A6D';

export const BLOG_COVER_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
