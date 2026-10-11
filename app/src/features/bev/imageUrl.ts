/**
 * The route param, decoded. Expo Router decodes once; a link that encoded the URL twice still
 * reads "https%3A…", so decode again only then. Only web image URLs are shown.
 */
export function imageUrlFromParam(param: string | string[] | undefined): string | null {
  let url = Array.isArray(param) ? param[0] : param;
  if (!url) return null;
  if (/^(https?|blob)%3A/i.test(url)) {
    try {
      url = decodeURIComponent(url);
    } catch {
      return null;
    }
  }
  return /^(https?:|blob:|data:image\/)/i.test(url) ? url : null;
}
