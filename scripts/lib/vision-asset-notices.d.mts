export function verifyVisionAssetNotices(
  publicDirectory: string,
  options?: { requireReviewedRights?: boolean },
): Promise<{
  noticeFilesVerified: true;
  assetFilesVerified: number;
  visionRightsReviewed: boolean;
  pendingRights: string[];
}>;
