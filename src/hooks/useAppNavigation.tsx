import { useNavigate } from 'react-router-dom';

export const CorpusenseRoutes = {
  MANIFEST: 'manifest',
  COLLECTIONS: 'collections',
  COLLECTION: 'collection',
  CONFIGURATION: 'configuration',
  MODELS: 'models',
  STORAGE: 'storage',
  WORKERS: 'workers',
};

const useAppNavigation = () => {
  const navigate = useNavigate();

  const goToManifestExplorer = async (manifestId?: string) => {
    if (manifestId === undefined) {
      await navigate(`${CorpusenseRoutes.MANIFEST}`);
    } else {
      await navigate(`${CorpusenseRoutes.MANIFEST}?manifestId=${manifestId}`);
    }
  };
  const goToCollectionsManager = async () => {
    await navigate(`/${CorpusenseRoutes.COLLECTIONS}`);
  };
  const goToCollectionInspector = async (collectionId: string) => {
    await navigate(`/${CorpusenseRoutes.COLLECTIONS}/${collectionId}`);
  };
  const goToConfiguration = async () => {
    await navigate(`/${CorpusenseRoutes.CONFIGURATION}`);
  };
  const goToModelsManager = async () => {
    await navigate(`/${CorpusenseRoutes.MODELS}`);
  };
  const goToStorage = async () => {
    await navigate(`/${CorpusenseRoutes.STORAGE}`);
  };
  const goToWorkersManager = async () => {
    await navigate(`/${CorpusenseRoutes.WORKERS}`);
  };
  const goToHome = async () => {
    await navigate('/');
  }

  const goToLogin = async () => {
    await navigate('/login');
  }
  const goToRegister = async () => {
    await navigate('/register');
  }

  const goToCollection = async (collectionId: string) => {
    await navigate(`/${CorpusenseRoutes.COLLECTION}/${collectionId}`);
  }

  return {
    goToManifestExplorer,
    goToCollectionsManager,
    goToCollectionInspector,
    goToConfiguration,
    goToModelsManager,
    goToStorage,
    goToWorkersManager,
    goToHome,
    goToLogin,
    goToRegister,
    goToCollection
  };
};

export default useAppNavigation;
