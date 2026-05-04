// Optional helper that wraps `expo-image-picker` so host apps don't have to
// wire the picker -> AttachmentInput conversion themselves.
//
// expo-image-picker is an OPTIONAL peer dep — it's required lazily so the SDK
// stays usable in apps that bring their own picker (PHPicker, react-native-
// image-picker, etc.). If you call these helpers without installing it, you
// get a clear error.
import type { AttachmentInput, AttachmentKind } from "./types";

type ExpoImagePickerModule = typeof import("expo-image-picker");

async function loadPicker(): Promise<ExpoImagePickerModule> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-image-picker") as ExpoImagePickerModule;
  } catch {
    throw new Error(
      "pickImage()/pickVideo() require 'expo-image-picker'. " +
        "Install it in your app: `npx expo install expo-image-picker`.",
    );
  }
}

function mimeFromUri(uri: string, fallback: string): string {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return (ext && map[ext]) || fallback;
}

async function fileSize(uri: string): Promise<number> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    return 0;
  }
}

function assetToInput(
  asset: {
    uri: string;
    mimeType?: string | null;
    width?: number;
    height?: number;
    duration?: number | null;
    fileSize?: number | null;
    type?: string | null;
  },
  kind: AttachmentKind,
  sizeBytes: number,
): AttachmentInput {
  return {
    uri: asset.uri,
    mime: asset.mimeType || mimeFromUri(asset.uri, kind === "image" ? "image/jpeg" : "video/mp4"),
    kind,
    size_bytes: asset.fileSize ?? sizeBytes,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.duration ? Math.round(asset.duration) : undefined,
  };
}

export type PickOptions = {
  multiple?: boolean;
  selectionLimit?: number;
  quality?: number;
  allowsEditing?: boolean;
};

export async function pickImage(options: PickOptions = {}): Promise<AttachmentInput[]> {
  const ImagePicker = await loadPicker();
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo library permission denied");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: !!options.multiple,
    selectionLimit: options.selectionLimit ?? (options.multiple ? 10 : 1),
    quality: options.quality ?? 0.85,
    allowsEditing: options.allowsEditing ?? false,
    exif: false,
  });
  if (result.canceled) return [];

  const out: AttachmentInput[] = [];
  for (const a of result.assets ?? []) {
    const size = a.fileSize ?? (await fileSize(a.uri));
    out.push(assetToInput(a, "image", size));
  }
  return out;
}

export async function pickVideo(
  options: Omit<PickOptions, "multiple" | "selectionLimit"> = {},
): Promise<AttachmentInput[]> {
  const ImagePicker = await loadPicker();
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo library permission denied");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    allowsEditing: options.allowsEditing ?? false,
    quality: options.quality ?? 1,
  });
  if (result.canceled) return [];

  const out: AttachmentInput[] = [];
  for (const a of result.assets ?? []) {
    const size = a.fileSize ?? (await fileSize(a.uri));
    out.push(assetToInput(a, "video", size));
  }
  return out;
}

export async function captureFromCamera(
  kind: AttachmentKind = "image",
  options: Omit<PickOptions, "multiple" | "selectionLimit"> = {},
): Promise<AttachmentInput[]> {
  const ImagePicker = await loadPicker();
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Camera permission denied");

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: kind === "video" ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
    allowsEditing: options.allowsEditing ?? false,
    quality: options.quality ?? 0.85,
    exif: false,
  });
  if (result.canceled) return [];

  const out: AttachmentInput[] = [];
  for (const a of result.assets ?? []) {
    const size = a.fileSize ?? (await fileSize(a.uri));
    out.push(assetToInput(a, kind, size));
  }
  return out;
}

export async function pickAndSendImage(args: {
  send: (text: string, attachments?: AttachmentInput[]) => Promise<unknown>;
  text?: string;
  options?: PickOptions;
}): Promise<AttachmentInput[]> {
  const picked = await pickImage(args.options);
  if (picked.length === 0) return [];
  await args.send(args.text ?? "", picked);
  return picked;
}

export async function pickAndSendVideo(args: {
  send: (text: string, attachments?: AttachmentInput[]) => Promise<unknown>;
  text?: string;
  options?: Omit<PickOptions, "multiple" | "selectionLimit">;
}): Promise<AttachmentInput[]> {
  const picked = await pickVideo(args.options);
  if (picked.length === 0) return [];
  await args.send(args.text ?? "", picked);
  return picked;
}

export async function captureAndSend(args: {
  send: (text: string, attachments?: AttachmentInput[]) => Promise<unknown>;
  kind?: AttachmentKind;
  text?: string;
  options?: Omit<PickOptions, "multiple" | "selectionLimit">;
}): Promise<AttachmentInput[]> {
  const picked = await captureFromCamera(args.kind ?? "image", args.options);
  if (picked.length === 0) return [];
  await args.send(args.text ?? "", picked);
  return picked;
}
