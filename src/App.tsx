import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { CorpusenseRoutes } from './hooks/useAppNavigation'
import CollectionInspectorPage from './pages/CollectionInspectorPage'
import CollectionsManagerPage from './pages/CollectionsManagerPage'
import ConfigurationPage from './pages/ConfigurationPage'
import Layout from './pages/Layout'
import ManifestExplorerPage from './pages/ManifestExplorerPage'
import LoginPage from '@/pages/LoginPage'
import { AuthProvider } from './contexts/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import ProfilePage from '@/pages/ProfilePage.tsx';
import RegisterPage from '@/pages/RegisterPage.tsx';
import HomeRedirect from './components/HomeRedirect'

const basePath: string = import.meta.env.VITE_BASE_PATH || '/'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basePath}>
        <Routes>
          <Route index element={<HomeRedirect />} />

          <Route path={CorpusenseRoutes.LOGIN} element={<LoginPage />} />
          <Route path={CorpusenseRoutes.REGISTER} element={<RegisterPage />} />

          <Route element={<PrivateRoute />}>
            <Route element={<Layout />}>
              <Route path={CorpusenseRoutes.PROFILE} element={<ProfilePage />} />
              <Route path={CorpusenseRoutes.MANIFEST} element={<ManifestExplorerPage />} />
              <Route path={CorpusenseRoutes.COLLECTIONS} element={<CollectionsManagerPage />} />
              <Route
                path={`${CorpusenseRoutes.COLLECTIONS}/:collectionId`}
                element={<CollectionInspectorPage />}
              />
              <Route path={CorpusenseRoutes.CONFIGURATION} element={<ConfigurationPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
export default App
