import { useAlertDialogContext } from '@/components/reducers/useAlertDialogContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {FileUploader} from "react-drag-drop-files";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import UploadFileForm from '@/components/UploadFileForm';
import { CollectionDetails } from '@/data/models/Collection';
import { useAppDispatch, useAppSelector } from '@/hooks/hooks';
import useDialog from '@/hooks/ui/useDialog';
import useAppNavigation from '@/hooks/useAppNavigation';
import { removeCollectionRequest } from '@/state/reducers/collections';
import { exportCollectionsRequest } from '@/state/reducers/export';
import { selectCollections } from '@/state/selectors/collections';
import { selectTagsByIds } from '@/state/selectors/tags';
import { DownloadIcon, FilePlus, Import, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ContextMenu from '@/components/menu/ContextMenu.tsx';
import FileComponent from '@/components/FileComponent.tsx';
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { supabase } from '@/utils/config.ts';

interface FileProps {
  id: string;
  name: string;
}

interface ResponseProps{
  data: {
    upload: {
      path: string;
      id: string;
    };
  };
  error: {
    message: string;
  };
}

const CollectionTableRow = ({
  collection,
  addOrRemoveCollection,
}: {
  collection: CollectionDetails;
  addOrRemoveCollection: (collectionId: string, isAdd: boolean) => void;
}) => {
  const { t } = useTranslation();
  const navigation = useAppNavigation();
  const dispatch = useAppDispatch();
  const { openDialog } = useAlertDialogContext();

  const { lastExportContent, lastExportDate, lastExportStatus } = useAppSelector(
    (state) => state.export,
  );
  const tags = useAppSelector((state) => selectTagsByIds(state, collection.tags));

  const [downloadLink, setDownloadLink] = useState<string>('');

  useEffect(() => {
    if (lastExportDate !== null) {
      const blob = new Blob([lastExportContent as string], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      setDownloadLink(url);
    }
  }, [lastExportContent]);

  const handleDelete = (id: string) => {
    openDialog({
      title: t('title_are_you_sure'),
      description: t('description_delete_collection'),
      onConfirm: {
        message: t('btn_yes'),
        action: () => dispatch(removeCollectionRequest(id)),
      },
    });
  };

  const handleOnClick = async (id: string) => {
    await navigation.goToCollectionInspector(id);
  };

  const handleDownload = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    event.stopPropagation();
    const link = document.createElement('a');
    link.href = downloadLink;
    link.download = 'export.csv';
    link.click();
  };

  return (
    <TableRow onClick={() => void handleOnClick(collection.id)} onContextMenu={(e) => {
      e.preventDefault();
    }}>
      <TableCell>
        <Checkbox
          aria-label={t('aria_label_selection_collection')}
          onClick={(e) => {
            e.stopPropagation();
            addOrRemoveCollection(
              collection.id,
              (e.target as HTMLInputElement).dataset['state'] === 'unchecked',
            );
          }}
        />
      </TableCell>
      <TableCell>{collection.name}</TableCell>
      <TableCell>{collection.id}</TableCell>
      <TableCell>
        {collection.contentSize === 0 ? (
          <Badge variant='secondary' className='text-sm'>
            {t('info_empty_collection')}
          </Badge>
        ) : (
          <Badge className='text-md font-bold'>
            {t('info_number_of_items', { number: collection.contentSize })}
          </Badge>
        )}
      </TableCell>
      <TableCell className='space-y-1 space-x-1'>
        {tags.map((tag) => (
          <Badge key={tag?.id}>{tag?.label}</Badge>
        ))}
      </TableCell>
      <TableCell className='space-x-2 align-middle'>
        <Button
          variant='destructive'
          onClick={(event) => {
            event.stopPropagation();
            handleDelete(collection.id);
          }}
          title={t('btn_delete')}
          aria-label={t('btn_delete')}
        >
          <Trash2 />
        </Button>
        {lastExportStatus === 'OK' && (
          <Button
            className='rounded bg-cyan-400 px-4 py-2 text-slate-900 transition hover:bg-cyan-600 hover:text-white'
            onClick={(e) => handleDownload(e)}
          >
            <DownloadIcon />
            {t('btn_download_export')}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

const CollectionsManagerPage = () => {
  const { t } = useTranslation();
  const collections: CollectionDetails[] = useAppSelector(selectCollections);
  const { openImportCollectionDialog, openNewCollectionDialog, openExportCollectionDialog } =
    useDialog();

  const [files, setFiles] = useState<FileProps[]>([]);
  const { t } = useTranslation();
  const fileTypes = ["JPG", "PNG", "PDF"];
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const user = userData?.user;
        if (!user?.id) throw new Error("Utilisateur non authentifié");

        console.log("User:", user);
        const { data, error: listErr } = await supabase.storage
          .from("images")
          .list(user.id, {
            limit: 100,
            offset: 0,
            sortBy: { column: "name", order: "asc" },
          });

        if (listErr) throw listErr;
        setFiles(data ?? []);
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

  const addOrRemoveCollection = (id: string, isAdd: boolean) => {
    if (isAdd) {
      if (!selectedCollections.includes(id)) {
        setSelectedCollections(selectedCollections.concat(id));
      }
    } else {
      setSelectedCollections(selectedCollections.filter((collection) => collection !== id));
    }
  };

  const handleExport = () => {
    openExportCollectionDialog(selectedCollections);
  };

  const handleDelete = () => {
    if (collectionToDelete === null) return;
    dispatch(removeCollectionRequest(collectionToDelete));
    setCollectionToDelete(null);
  };

  const handleFileAdded = async (file: File | File[]) => {
    if (Array.isArray(file)) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("bucket", "images");

    const response : ResponseProps = await supabase.functions.invoke("upload-image", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    }) as unknown as ResponseProps;
    console.log(response);
    const filePath : string[] = response.data.upload.path.split("/");
    const fileName = filePath[filePath.length - 1];

    setFiles(files.concat({name: fileName, id: response.data.upload.id}));

  };

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event;
    console.log("active", active);
    console.log("over", over);
    /*
    const { data, error } = await supabase
  .storage
  .from('avatars')
  .move('public/avatar1.png', 'private/avatar2.png')
     */
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
    <div className='panel flex-col items-center space-y-4'>
      <section className='mt-2 ml-4 flex w-full justify-center space-x-2'>
        <button
          className='soft-button'
          title={t('btn_create_collection')}
          onClick={openNewCollectionDialog}
        >
          <FilePlus />
          {t('btn_create_collection')}
        </button>
        <button
          className='soft-button'
          title={t('btn_import_collection')}
          onClick={openImportCollectionDialog}
        >
          <Import />
          {t('btn_import_collection')}
        </button>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <FileUploader handleChange={(file: File | File[]) => handleFileAdded(file)} name="file" types={fileTypes}/>
      </section>

      {collections.length > 0 ? (
        <section className='flex h-full w-4/5 flex-col items-center space-y-1'>
          <h2 className='text-xl'>
            {t('info_number_of_collections', { number: collections.length })}
          </h2>
          <div className='flex flex-row w-full flex-wrap justify-center gap-2 overflow-y-auto p-2' >
          {collections.map((collection) => (
              <ContextMenu key={collection.id} collection={collection}/>
          ))}
            {files.map((file, index) => (
              <FileComponent key={index} id={index} name={file.name}/>
            ))}
          </div>

          <AlertDialog
            open={collectionToDelete !== null}
            onOpenChange={() => setCollectionToDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('title_are_you_sure')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('description_delete_collection')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className='soft-button bg-white'>
                  {t('btn_no')}
                </AlertDialogCancel>
                <AlertDialogAction
                  className='soft-button bg-red-400 hover:bg-red-700'
                  onClick={handleDelete}
                >
                  {t('btn_yes')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      ) : (
        <div role='alert' className='text-2xl'>
          {t('info_no_collection')}
        </div>
      )}
    </div>
    </DndContext>
  );
};

export default CollectionsManagerPage;
