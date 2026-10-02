import { useState } from 'react'
import { supabase } from './lib/supabaseClient'
import BlogContentManager from './BlogContentManager.jsx'
import './AuthenticatedView.css'

function AuthenticatedView({ session, onBack, onSignedOut }) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSignOut() {
    setIsSigningOut(true)
    setErrorMessage('')

    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setErrorMessage(error.message)
        return
      }
      onSignedOut()
    } catch {
      setErrorMessage('No se pudo cerrar la sesión. Intenta de nuevo.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <main className="authenticated-page">
      <header className="authenticated-header">
        <button className="brand" type="button" onClick={onBack} aria-label="Volver a las vistas">
          <span className="brand-mark" aria-hidden="true">{"</>"}</span>
          <span className="brand-name">Administración</span>
        </button>
        <button className="authenticated-back" type="button" onClick={handleSignOut}>
          <span aria-hidden="true">←</span> {isSigningOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
        </button>
      </header>

      <section className="authenticated-content" aria-labelledby="authenticated-title">
        {errorMessage && <p className="authenticated-error" role="alert">{errorMessage}</p>}

        <BlogContentManager userEmail={session.user.email} />

        {/* <button className="authenticated-signout" type="button" onClick={handleSignOut} disabled={isSigningOut}>
          {isSigningOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
        </button> */}
      </section>
    </main>
  )
}

export default AuthenticatedView
