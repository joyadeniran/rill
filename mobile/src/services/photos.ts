import * as ImagePicker from 'expo-image-picker';
import { uploadPhoto, type PhotoKind } from './api';

/**
 * Field photo capture for the CO app.
 *
 * Everything here returns a discriminated result rather than throwing, because
 * every failure mode (permission denied, user cancelled, file too big) is a
 * normal thing that happens in the field and must render as a calm message —
 * not an error boundary.
 */
export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'permission'; message: string }
  | { ok: false; reason: 'error'; message: string };

// The server caps a photo at 2MB decoded. Compressing on-device keeps us well
// under that AND matters on Nigerian field data plans, where uploading a 4MB
// original over 3G is the difference between a 2-second and a 40-second wait.
const IMAGE_QUALITY = 0.5;
const MAX_DIMENSION = 1280;

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: IMAGE_QUALITY,
  base64: true,
  allowsEditing: false,
  exif: false // don't ship GPS/EXIF of a merchant's premises to the server
};

function toDataUrl(asset: ImagePicker.ImagePickerAsset): CaptureResult {
  if (!asset.base64) {
    return { ok: false, reason: 'error', message: 'Could not read that image. Please try again.' };
  }
  // expo-image-picker reports mimeType on newer SDKs; fall back to JPEG, which
  // is what the camera produces.
  const mime = asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
  return { ok: true, dataUrl: `data:${mime};base64,${asset.base64}` };
}

/** Take a new photo with the camera. */
export async function capturePhoto(): Promise<CaptureResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        ok: false,
        reason: 'permission',
        message: permission.canAskAgain
          ? 'Camera access is needed to take field photos.'
          : 'Camera access is blocked. Enable it for Rill CO in your phone settings.'
      };
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: 'cancelled' };
    return toDataUrl(result.assets[0]);
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'The camera could not be opened.'
    };
  }
}

/** Pick an existing photo from the library. */
export async function pickPhoto(): Promise<CaptureResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return {
        ok: false,
        reason: 'permission',
        message: permission.canAskAgain
          ? 'Photo access is needed to attach an existing picture.'
          : 'Photo access is blocked. Enable it for Rill CO in your phone settings.'
      };
    }
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: 'cancelled' };
    return toDataUrl(result.assets[0]);
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Your photos could not be opened.'
    };
  }
}

/**
 * Capture and upload in one step. Returns a user-facing message on failure so
 * the caller never has to translate an exception into UI copy.
 */
export async function captureAndUpload(
  userId: string,
  kind: PhotoKind,
  caption?: string,
  source: 'camera' | 'library' = 'camera'
): Promise<{ ok: true; id: string } | { ok: false; message: string | null }> {
  const captured = source === 'camera' ? await capturePhoto() : await pickPhoto();

  if (!captured.ok) {
    // A cancel is not an error — the caller should show nothing at all.
    if (captured.reason === 'cancelled') return { ok: false, message: null };
    return { ok: false, message: captured.message };
  }

  try {
    const { id } = await uploadPhoto({ userId, kind, dataUrl: captured.dataUrl, caption });
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The photo could not be uploaded.'
    };
  }
}

export const PHOTO_CONSTRAINTS = { IMAGE_QUALITY, MAX_DIMENSION };
