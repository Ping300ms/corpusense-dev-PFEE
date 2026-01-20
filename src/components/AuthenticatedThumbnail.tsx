import { IIIFExternalWebResource } from '@iiif/presentation-3';
import { Thumbnail as CloverThumbnail } from '@samvera/clover-iiif/primitives';
import { useEffect, useState } from 'react';
import { getImageUrl } from '@/utils/imageProxy';
import { supabase } from '@/utils/config';

interface AuthenticatedThumbnailProps {
  thumbnail: IIIFExternalWebResource[];
  token?: string | null;
  style?: React.CSSProperties;
  'aria-label'?: string;
  draggable?: boolean;
}

/**
 * Wrapper around Clover's Thumbnail component that adds authentication support
 * for private images by fetching them with Authorization headers
 */
export const AuthenticatedThumbnail = ({
  thumbnail,
  token: externalToken,
  style,
  'aria-label': ariaLabel,
  draggable,
}: AuthenticatedThumbnailProps) => {
  const [proxiedThumbnail, setProxiedThumbnail] = useState<IIIFExternalWebResource[]>(thumbnail);
  const [token, setToken] = useState<string | null>(externalToken ?? null);

  // Récupérer le token si non fourni
  useEffect(() => {
    if (externalToken !== undefined) {
      setToken(externalToken);
      return;
    }

    const getToken = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          setToken(session.access_token);
        }
      } catch (err) {
        console.warn('Error getting auth token in AuthenticatedThumbnail:', err);
      }
    };
    void getToken();
  }, [externalToken]);

  useEffect(() => {
    const proxyThumbnails = async () => {
      const proxied = await Promise.all(
        thumbnail.map(async (thumb) => ({
          ...thumb,
          id: await getImageUrl(thumb.id!, token),
        }))
      );
      setProxiedThumbnail(proxied);
    };

    if (token) {
      void proxyThumbnails();
    }
  }, [thumbnail, token]);

  return (
    <CloverThumbnail
      thumbnail={proxiedThumbnail}
      style={style}
      aria-label={ariaLabel}
      draggable={draggable}
    />
  );
};
