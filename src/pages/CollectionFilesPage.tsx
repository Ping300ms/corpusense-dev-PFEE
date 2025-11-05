import CollectionToolbar from '@/components/CollectionToolbar';
import { useAppDispatch, useAppSelector } from '@/hooks/hooks';
import { fetchAnnotationsRequest } from '@/state/reducers/annotations';
import { loadCollectionRequest } from '@/state/reducers/collections';
import { loadEntitiesRequest } from '@/state/reducers/namedEntities';
import { selectCurrentCollection } from '@/state/selectors/collections';
import { Canvas } from '@iiif/presentation-3';
import 'gridstack/dist/gridstack.min.css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import FileComponent from '@/components/FileComponent.tsx';

const CollectionFilesContent = ({ collectionId }: { collectionId: string }) => {
  const { t } = useTranslation();
  const appDispatch = useAppDispatch();
  const currentCollection = useAppSelector(selectCurrentCollection);
  const [canvasToDisplay, setCanvasToDisplay] = useState<Canvas | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('document');
  useEffect(() => {
    if (canvasToDisplay !== undefined) {
      appDispatch(fetchAnnotationsRequest({ canvasId: canvasToDisplay.id, collectionId }));
      appDispatch(loadEntitiesRequest({ canvasId: canvasToDisplay.id, collectionId }));
    }
  }, [canvasToDisplay]);

  if(!currentCollection){
    return <div className='flex justify-center'>{t('error_id_collection_invalid')}</div>
  }

  if(currentCollection.content.length === 0){
    return <div className='flex justify-center'>{t('info_empty_collection')}</div>
  }

  return (
    <section className='h-full max-h-full w-full max-w-full'>
              {currentCollection.content.length > 0 && (
                <CollectionToolbar collectionId={collectionId} />
              )}
      {currentCollection.content.map((file) => (
        <FileComponent key={file.canvasId} name={file.manifestId} id={file.canvasId}/>
      ))}
    </section>
  );
};

const CollectionFilesPage = () => {
  const { t } = useTranslation();
  const { collectionId } = useParams();
  const dispatch = useAppDispatch();
  console.log('CollectionFilesPage collectionId: ', collectionId);

  useEffect(() => {
    console.log('CollectionFilesPage collectionId - useEffect: ', collectionId);
    if (collectionId !== undefined) {
      dispatch(loadCollectionRequest(collectionId));
    }
  }, [collectionId]);

  return collectionId === undefined ? (
    <div className='flex justify-center'>{t('error_id_collection_invalid')}</div>
  ) : (
    <div className='bg-amber-50'>
    <CollectionFilesContent collectionId={collectionId} />
    </div>
  );
};

export default CollectionFilesPage;
