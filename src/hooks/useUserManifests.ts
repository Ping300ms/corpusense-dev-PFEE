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

export function useUserManifests() {
  const [existingManifests, setExistingManifests] = useState<string[]>([]);
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

        console.log("userID : ", user.id);
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

        let directories = getPublicDirectoriesData?.map(({ name }) => name) ?? [];
        directories = directories.concat(getPrivateDirectoriesData?.map(({ name }) => name) ?? []);
        const urls : string[] = [];
        console.log("DIR: ", directories);
        if (getPublicDirectoriesError && getPrivateDirectoriesError && userFilesError) {
          setError(userFilesError);
        }
        if (directories.length > 0) {
          urls.push(...directories.map((dir) => {
            return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-resource?path=${user.id}/${dir}/manifest.json`;
          }));
          console.log("URLS: ", urls);
        }
        if(userFiles !== null && userFiles.length > 0) {
          urls.push(...userFiles.map((file) => {
            const { data } = supabase.storage.from('corpusense').getPublicUrl(file.name);
            return data.publicUrl;
          }));
        }
        setExistingManifests(urls);
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
