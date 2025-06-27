import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { CorpusenseRoutes } from './hooks/useAppNavigation'
import CollectionInspectorPage from './pages/CollectionInspectorPage'
import CollectionsManagerPage from './pages/CollectionsManagerPage'
import ConfigurationPage from './pages/ConfigurationPage'
import Layout from './pages/Layout'
import ManifestExplorerPage from './pages/ManifestExplorerPage'
import LoginPage from '@/pages/LoginPage'
import { AuthProvider } from './contexts/AuthContext'
import ProfilePage from '@/pages/ProfilePage.tsx';
import RegisterPage from '@/pages/RegisterPage.tsx';

const basePath: string = (import.meta.env.VITE_BASE_PATH as string) || '/'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basePath}>
        <Routes>
          <Route path={CorpusenseRoutes.LOGIN} element={<LoginPage />} />
          <Route path={CorpusenseRoutes.REGISTER} element={<RegisterPage />} />

          <Route element={<Layout />}>
            <Route index element={<CollectionsManagerPage/>} />
            <Route path={CorpusenseRoutes.PROFILE} element={<ProfilePage />} />
            <Route path={CorpusenseRoutes.MANIFEST} element={<ManifestExplorerPage />} />
            <Route path={CorpusenseRoutes.COLLECTIONS} element={<CollectionsManagerPage />} />
            <Route
              path={`${CorpusenseRoutes.COLLECTIONS}/:collectionId`}
              element={<CollectionInspectorPage />}
            />
            <Route path={CorpusenseRoutes.CONFIGURATION} element={<ConfigurationPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
export default App
