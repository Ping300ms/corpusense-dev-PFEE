/**
 * Image Proxy Utility
 * Fetches images with authentication headers and returns blob URLs
 * This allows private images to be loaded through <img> tags
 */

const imageCache = new Map<string, string>();

/**
 * Fetch an image with authentication headers and return a blob URL
 * @param imageUrl - The URL of the image to fetch
 * @param token - Optional authentication token
 * @returns A blob URL or the original URL if no token is provided
 */
export async function getImageUrl(
  imageUrl: string,
  token: string | null
): Promise<string> {
  // If no token, return original URL (public image)
  if (!token) {
    return imageUrl;
  }

  // Check cache first
  const cacheKey = `${imageUrl}::${token}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  try {
    // Fetch image with Authorization header
    const response = await fetch(imageUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch image ${imageUrl}: ${response.status}`);
      return imageUrl; // Fallback to original URL
    }

    // Convert to blob and create object URL
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    // Cache the blob URL
    imageCache.set(cacheKey, blobUrl);
    
    return blobUrl;
  } catch (error) {
    console.error(`Error fetching image ${imageUrl}:`, error);
    return imageUrl; // Fallback to original URL
  }
}

/**
 * Clean up cached blob URLs to prevent memory leaks
 */
export function clearImageCache(): void {
  imageCache.forEach((blobUrl) => {
    URL.revokeObjectURL(blobUrl);
  });
  imageCache.clear();
}

/**
 * Revoke a specific cached blob URL
 */
export function revokeImageUrl(imageUrl: string, token: string | null): void {
  if (!token) return;
  
  const cacheKey = `${imageUrl}::${token}`;
  const blobUrl = imageCache.get(cacheKey);
  
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    imageCache.delete(cacheKey);
  }
}
