import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

const HomeRedirect = () => {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) {
      if (user) {
        navigate('/collections')  // ou la page protégée par défaut
      } else {
        navigate('/login')        // page login
      }
    }
  }, [user, loading, navigate])

  return null // rien à afficher ici, juste une redirection
}

export default HomeRedirect
