export const ICON_BUCKET = 'bev-generated-icons';

/**
 * The object URL a finished icon is uploaded to. Extracted so a test can
 * assert it, which is the gap that let the rename miss the writer: asserting
 * the CONSTANT would not have caught an upload that ignored it.
 */
export function iconUploadUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl}/storage/v1/object/${ICON_BUCKET}/${objectPath}`;
}
