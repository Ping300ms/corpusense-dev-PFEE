import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/utils/config';
import { generateManifest } from '@/utils/manifest';
import { Manifest } from '@iiif/presentation-3';
import { Archive } from 'lucide-react';
// import imageBlobReduce from 'image-blob-reduce';
import { useAppSelector } from '@/hooks/hooks';
import { useUserManifests } from '@/hooks/useUserManifests';
import { selectAuthStatus } from '@/state/selectors/auth';
import * as pdfjsLib from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks';
import { useTranslation } from 'react-i18next';
import { SyncLoader } from 'react-spinners';
import { Loader, Lock, LockOpen, Share2 } from 'lucide-react';
import useDialog from '@/hooks/ui/useDialog.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const CANTALOUPE_URL = import.meta.env.VITE_CANTALOUPE_URL as string;

// const reduceBlob = imageBlobReduce();

type ImageData = {
  data: string;
  width: number;
  height: number;
  fullImageUrl?: string;
  thumbImageUrl?: string;
};

type ManifestData = {
  url: string;
  name: string;
  isPrivate: boolean;
  loading: boolean;
}

async function uploadToSupabase(
  folder: string,
  data: string | Manifest,
  fileName: string,
  userId: string,
  isPrivate: boolean
): Promise<void> {
  const blob : Blob = typeof data === 'string'
    ? await fetch(data).then((res) => res.blob())
    : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const { data: fullImageData, error: Error } = await supabase.storage
    .from(isPrivate ? 'private-images' : 'public-images')
    .upload(`${userId}/${folder}/${fileName}`, blob, {
      cacheControl: '3600',
      upsert: false,
    });
  if (Error) {
    console.error('Erreur upload :', Error.message);
  } else {
    console.log('Fichier uploadé :', fullImageData);
  }
}

const StoragePage = () => {
  const { t } = useTranslation();
  const [documentName, setDocumentName] = useState<string>('');
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);
  const { existingManifests, loading, error } = useUserManifests();
  const [uploading, setUploading] = useState(false);
  const isConnected = useAppSelector(selectAuthStatus) === 'authenticated';
  const [images, setImages] = useState<ImageData[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string| null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [progressRenderPDFToImages, setProgressRenderPDFToImages] = useState(0);
  const [isPrivate, setIsPrivate] = useState(false);
  const [userManifests, setUserManifests] = useState<ManifestData[]>([]);
  const { openShareManifestDialog } = useDialog();



  useEffect(() => {
    void (async () => {
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const user = userData?.user;
        if (!user?.id) throw new Error("Utilisateur non authentifié");

        setUserId(user.id);

        const session = supabase.auth.getSession !== null
          ? (await supabase.auth.getSession()).data.session
          : null;
        const _token = session?.access_token ?? (await supabase.auth.getUser()).data?.user?.id_token as string ?? null;
        setToken(_token);
        if (token === null || token === undefined) {
          throw new Error("No auth token available; please sign in first");
        }

      } catch (e: any) {
        console.error(e);
      }
      return null;
    })();
  }, []);

  useEffect(() => {
    console.log("EXISTING MANIFESTS:",existingManifests);
    setUserManifests(existingManifests.map(manifest => ({
      url: manifest.url,
      name: manifest.name,
      isPrivate: manifest.isPrivate,
      loading: false})));
    console.log("USER MANIFESTS:",userManifests);
  }, existingManifests);

  async function renderPdfToImages(file: File): Promise<ImageData[]> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const _images: ImageData[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 }); // ↑ changer le scale si nécessaire

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      const imgDataUrl = canvas.toDataURL('image/png');
      _images.push({ data: imgDataUrl, width: viewport.width, height: viewport.height });
      setProgressRenderPDFToImages(Math.floor((pageNum / pdf.numPages) * 100));
    }
    setProgressRenderPDFToImages(0);
    return _images;
  }

  if (!isConnected) {
    return (
      <div className='panel h-full w-full flex-col space-y-2'>
        <h1 className='flex items-center text-2xl font-bold'>
          <Archive className='mr-2' /> {t('page_title_storage')}
        </h1>
        <p>{t('info_not_connected_description')}</p>
      </div>
    );
  }

  const hrefPath = `${window.location.origin}${import.meta.env.VITE_BASE_PATH ?? ''}/manifest?manifestId=`;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file: File | undefined = event.target.files?.[0];
    setIsUploading(true);
    if (file) {
      const _images = await renderPdfToImages(file);
      setImages([...images, ..._images]);
    }
    setIsUploading(false);
  };

  const handleDeletePage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  }

  const handleLoadPdf = () => {
    if (images.length === 0) {
      alert('Veuillez sélectionner un fichier PDF ou attendre la fin du chargement.');
      return;
    }

    if (documentName.trim() === '') {
      alert('Veuillez entrer un nom pour le document.');
      return;
    }

    const loadPdf = async () => {
      setUploading(true);
      await Promise.all(
        images.map(async (img, i) => {
          const filename = `${documentName}_${i + 1}.png`;

          const uploadPromise = uploadToSupabase(
            documentName,
            img.data,
            filename,
            userId ?? '',
            isPrivate
          );

          // Update URLs synchronously
          img.fullImageUrl =
            `${CANTALOUPE_URL}${userId}%252F${documentName}%252F${filename}/full/max/0/default.png`;

          img.thumbImageUrl =
            `${CANTALOUPE_URL}${userId}%252F${documentName}%252F${filename}/full/,120/0/default.png`;

          return uploadPromise;
        })
      );

      const newManifest = generateManifest(
        documentName.trim(),
        images.map((img) => ({
          id: img.fullImageUrl ?? '',
          thumb: img.thumbImageUrl ?? '',
          width: img.width,
          height: img.height,
        })),
        `${userId}/${documentName}`, // Ajouter le préfixe de nom de fichier comme dossier ),
      );
      void uploadToSupabase(documentName, newManifest, "manifest.json", userId ?? '', isPrivate);
      console.log('Generated Manifest: ', newManifest);

      setManifestUrl(newManifest.id);
      setUploading(false);
    };
    void loadPdf();
    setImages([]);
    setDocumentName('');
  };

  const dragStart = (_ : React.DragEvent<HTMLDivElement>, position: number) => {
    dragItem.current = position;
  };

  const dragEnter = (_ : React.DragEvent<HTMLDivElement>, position: number) => {
    dragOverItem.current = position;
    setDropTargetIndex(position);
  };

  const changeBucket = async (
    directory: string,
    privateBucket: boolean
  ) => {
    setUserManifests(prev => prev.map(manifest => manifest.name === directory ? {...manifest, loading: true} : manifest))
    const sourceBucket = privateBucket ? 'private-images' : 'public-images';
    const destinationBucket = privateBucket ? 'public-images' : 'private-images';

    const { data, error: listError } = await supabase.storage
      .from(sourceBucket)
      .list(`${userId}/${directory}`, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (listError) {
      console.error(listError);
      throw listError;
    }

    if (data === undefined || data.length === 0) return;

    for (const file of data) {
      const sourcePath = `${userId}/${directory}/${file.name}`;
      const destinationPath = `${userId}/${directory}/${file.name}`;

      const { error: copyError } = await supabase.storage
        .from(sourceBucket)
        .copy(sourcePath, destinationPath, {
          destinationBucket,
        });

      if (copyError) {
        console.error(copyError);
        throw copyError;
      }

      const { error: removeError } = await supabase.storage
        .from(sourceBucket)
        .remove([sourcePath]);

      if (removeError) {
        console.error(removeError);
        throw removeError;
      }
    }
    setUserManifests(prev => prev.map(manifest => manifest.name === directory ? {...manifest, isPrivate: !privateBucket, loading: false} : manifest))
  };


  const drop = () => {
    const copyImages = [...images];
    if (dragItem.current === null || dragOverItem.current === null) return;
    const draggedImage = copyImages[dragItem.current];
    copyImages.splice(dragItem.current, 1);
    copyImages.splice(dragOverItem.current, 0, draggedImage);
    dragItem.current = null;
    dragOverItem.current = null;
    setDropTargetIndex(null);
    setImages(copyImages);
  };

  return (
    <div className='panel h-full w-full flex-col space-y-2'>
      <h1 className='flex items-center text-2xl font-bold'>
        <Archive className='mr-2' /> {t('page_title_storage')}
      </h1>
      <h2 className='text-lg'>Documents existants</h2>
      <div className='text-sm text-blue-600'>
        {loading ? (
          <p>Chargement...</p>
        ) : error ? (
          <p>Erreur lors du chargement.</p>
        ) : userManifests.length > 0 ? (
          userManifests.map((data, index) => (
            <div
              key={index}
              className={"mb-2 flex items-center gap-4 justify-between p-1" + (index !== userManifests.length - 1 ? ' border-b' : '')}
            >
              <a className="hover:text-blue-800" href={`${hrefPath}${data.url}`}>
                {data.name}
              </a>
              <div className={"flex gap-2"}>
              {data.loading ? (
                <Button>
                  <Loader />
                  Chargement
                </Button>
              ) : data.isPrivate ? (
                <div className="flex gap-2">
                <Button
                  className="text-red-500 bg-red-200 cursor-pointer"
                  onClick={() => changeBucket(data.name, data.isPrivate)}
                >
                  <Lock />
                  Privé
                </Button>
                  <Button onClick={() => openShareManifestDialog(userId + "/" + data.name, data.url)}>
                    <Share2 />
                    Partager
                  </Button>
                </div>
              ) : (
                <Button
                  className="text-green-500 bg-green-200 cursor-pointer"
                  onClick={() => changeBucket(data.name, data.isPrivate)}
                >
                  <LockOpen />
                  Public
                </Button>
              )}
              </div>
            </div>
          ))
        ) : (
          <p>Aucun document trouvé.</p>
        )}
      </div>
      <div className='flex flex-col items-center border p-2'>
        <h2 className='text-lg'>Ajouter un document</h2>
        <form className='flex w-1/2 flex-col space-y-2'>
          <div className="flex items-center gap-10">
          <Input
            type='text'
            required
            placeholder={t('form_placeholder_document_name')}
            value={documentName}
            onChange={(e) => setDocumentName(e.target.value)}
          />
          <label className="flex items-center gap-2" >Privé
          <input type='checkbox' checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}/>
          </label>
          </div>
          <Input type='file' accept='application/pdf' onChange={handleFileChange}/>
          <div className={"overflow-auto max-h-[500px] p-2"}>
            {isUploading &&
              <div className={"flex flex-col items-center justify-center p-4 gap-2 border rounded-lg shadow-md bg-white dark:bg-gray-800"}>
                <span className="text-sm">Conversion en images en cours...</span>
                <progress value={progressRenderPDFToImages} max={100} className={"w-full h-2"}/>
                <span className="text-sm">{progressRenderPDFToImages.toString() +"%"}</span>
              </div>}
          {!isUploading && images.length > 0 && (
            <div className="flex flex-wrap gap-2 flex-row">
              {images.map((image, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center p-3 rounded-lg w-40 relative justify-between"
                  draggable
                  onDragStart={(e) => dragStart(e, index)}
                  onDragEnter={(e) => dragEnter(e, index)}
                  onDragEnd={drop}
                  style={{ backgroundColor: (dropTargetIndex ?? -1) === index ? 'lightblue' : 'white' }}
                >
                  <Button type="button" className=" text-red-500 bg-transparent top-0 right-0 absolute" onClick={() => handleDeletePage(index)}>X</Button>
                  <img
                    src={image.data}
                    alt={`Page ${index}`}
                    className=""
                  />
                  <span className="mt-2">{"Page " + index}</span>
                </div>
              ))}
            </div>
          )}
          </div>
          {!uploading ? (
            <Button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleLoadPdf();
              }}
              className='w-auto self-center'
              type='submit'
            >
              Upload
            </Button>
          ) : (
            <div className={"flex flex-col items-center justify-center p-4 gap-10 "}>
              <span className="text-sm">Chargement en cours, ne quittes pas la page ! </span>
              <SyncLoader />
            </div>
          )}
          {manifestUrl !== null && (
            <div className='mt-4 flex flex-col items-center text-center'>
              <h2> 🥳 T&apos;es un winner !
                <br />
                Ton document est en ligne :&nbsp;
                <a className="font-medium text-fg-brand underline hover:no-underline accent-blue-500" href={manifestUrl}>ici</a>
              </h2>
              <Fireworks autorun={{ speed: 2, duration: 4 }} />
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default StoragePage;
