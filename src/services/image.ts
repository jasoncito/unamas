import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Longest side sent to /parse: enough to read a machine's shape and labels, and ~150 KB (CLAUDE.md §6). */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.6;

/** Photos of entries the session still needs (sent again with a retry or an answer). */
export interface PhotoStore {
  /** Moves a just-taken photo next to the app's data, named after its entry. Returns its uri. */
  keep(tempUri: string, entryId: string): string;
  /** The JPEG as base64 for /parse, or null if the file is gone. */
  base64(uri: string): Promise<string | null>;
}

const dir = () => new Directory(Paths.document, 'photos');

export const photos: PhotoStore & { prune(inUse: Set<string>): void } = {
  keep(tempUri, entryId) {
    const folder = dir();
    folder.create({ intermediates: true, idempotent: true });
    const target = new File(folder, `${entryId}.jpg`);
    if (target.exists) target.delete();
    new File(tempUri).copy(target);
    return target.uri;
  },
  async base64(uri) {
    const file = new File(uri);
    return file.exists ? file.base64() : null;
  },
  /** Deletes the photos no entry needs anymore (understood, or gone). */
  prune(inUse) {
    const folder = dir();
    if (!folder.exists) return;
    for (const item of folder.list()) if (item instanceof File && !inUse.has(item.uri)) item.delete();
  },
};

export type PhotoResult = { uri: string } | { error: 'permission' } | null;

/**
 * The camera, to photograph a machine they can't name; the photo library where there's no camera (the
 * simulator). Returns a resized JPEG in the cache, or null if they cancelled.
 */
export async function takeMachinePhoto(): Promise<PhotoResult> {
  let result: ImagePicker.ImagePickerResult;
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { error: 'permission' };
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  } catch {
    // No camera (simulator): the library instead.
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_SIDE) {
    context.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri };
}
