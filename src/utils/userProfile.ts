import { User } from '@supabase/supabase-js';

interface UserDisplayInfo {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string | null;
}

export const getUserDisplayInfo = (user: User | null): UserDisplayInfo => {
  if (user === null) {
    return {
      name: null,
      email: null,
      avatarUrl: null,
      provider: null
    };
  }

  const provider = user.app_metadata?.provider ?? null;
  const metadata = user.user_metadata ?? {};

  const name = (metadata.full_name as string | undefined) ??
    (metadata.name as string | undefined) ??
    (metadata.user_name as string | undefined) ??
    (metadata.preferred_username as string | undefined) ??
    (user.email?.split('@')[0] ?? null);

  const avatarUrl = (metadata.avatar_url as string | undefined) ??
    (metadata.picture as string | undefined) ??
    (metadata.profile_image_url as string | undefined) ??
    null;

  return {
    name,
    email: user.email ?? null,
    avatarUrl,
    provider
  };
};