import { supabase } from '@/utils/config';
import { AuthError, PostgrestError } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { throwError } from 'redux-saga-test-plan/providers';

//TODO : il est possible de générer les types à partir de supabase : npx supabase gen types typescript --project-id <project-id> > supabase-types.ts
type UserFile = {
  id: string;
  name: string;
  bucket_id: string;
  owner: string;
  created_at: string;
  updated_at: string;
};

type ManifestData = {
  url: string;
  name: string;
  isPrivate: boolean;
}

export function useUserManifests() {
  const [existingManifests, setExistingManifests] = useState<ManifestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuthError | PostgrestError | null>(null);

  useEffect(() => {
    const fetchStorageData = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setError(userError);
          setLoading(false);
          return;
        }
        const {
          data: userFiles,
          error: userFilesError,
        }: { data: UserFile[] | null; error: PostgrestError | null } = await supabase
          .from('user_files')
          .select()
          .eq('bucket_id', 'corpusense')
          .like('name', '%/manifest.json')
          .eq('owner', user.id);

        const { data: getPublicDirectoriesData, error: getPublicDirectoriesError } = await supabase
          .storage
          .from('public-images')
          .list(user.id, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          })

        if(getPublicDirectoriesError || getPublicDirectoriesData === null){
          throwError(getPublicDirectoriesError);
        }

        const { data: getPrivateDirectoriesData, error: getPrivateDirectoriesError } = await supabase
          .storage
          .from('private-images')
          .list(user.id, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          })

        if(getPrivateDirectoriesError || getPrivateDirectoriesData === null){
          throwError(getPrivateDirectoriesError);
        }

        const publicDirectories = getPublicDirectoriesData?.map(({ name }) => name) ?? [];
        const privateDirectories = getPrivateDirectoriesData?.map(({ name }) => name) ?? [];
        const manifestsData : ManifestData[] = [];
        if (getPublicDirectoriesError && getPrivateDirectoriesError && userFilesError) {
          setError(userFilesError);
        }
        if (publicDirectories.length > 0) {
          manifestsData.push(...publicDirectories.map((dir) => {
            return {url : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-resource?path=${user.id}/${dir}/manifest.json`,
              name : dir,
              isPrivate : false
          }
          }));
        }

        if (privateDirectories.length > 0) {
          manifestsData.push(...privateDirectories.map((dir) => {
            return {url : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-resource?path=${user.id}/${dir}/manifest.json`,
              name : dir,
              isPrivate : true
            }
          }));
        }
        /*
        if(userFiles !== null && userFiles.length > 0) {
          manifestsData.push(...userFiles.map((file) => {
            const { data } = supabase.storage.from('corpusense').getPublicUrl(file.name);
            return {
              url: data.publicUrl,
              name: file.name,
              isPrivate: false
            };
          }));
        }*/
        setExistingManifests(manifestsData);
      } catch (err) {
        setError(err as PostgrestError);
      } finally {
        setLoading(false);
      }
    };

    void fetchStorageData();
  }, []);

  return { existingManifests, loading, error };
}
