export function verifyAvatarProductAssets(root: string): Promise<{
  manifest: 'models/avatars/v1/manifest.json';
  assets: number;
}>;
