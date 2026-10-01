import { useState } from 'react'
import { supabase } from './lib/supabaseClient'
import './LoginView.css'

function LoginView({ onBack, onAuthenticated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')
    setIsSigningIn(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: username.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message)
        return
      }

      setPassword('')
      onAuthenticated(data.session)
    } catch {
      setErrorMessage('No se pudo conectar con el servicio. Intenta de nuevo.')
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <button className="brand login-brand" type="button" onClick={onBack} aria-label="Volver al sitio">
          <span className="brand-mark" aria-hidden="true">e.</span>
          <span className="brand-name">espacio<span>común</span></span>
        </button>
        <div className="login-intro-copy">
          <p className="eyebrow"><span className="eyebrow-rule" />ESPACIO COMÚN</p>
          <h1>Un lugar para las ideas y las personas.</h1>
          <p>Accede para continuar tu recorrido.</p>
        </div>
        <span className="login-intro-note">COMUNIDAD ABIERTA · CONTENIDO EN COMÚN</span>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <button className="login-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Volver a las vistas
        </button>
        <form className="login-form" onSubmit={handleSubmit}>
          <p className="login-kicker">ACCESO</p>
          <h2 id="login-title">Iniciar sesión</h2>
          <p className="login-description">Ingresa con el correo y contraseña de tu usuario de Supabase.</p>

          <label className="login-field">
            <span>Usuario (correo electrónico)</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="correo@ejemplo.com"
              required
            />
          </label>

          <label className="login-field">
            <span>Contraseña</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tu contraseña"
              required
            />
          </label>

          {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}

          <button className="login-submit" type="submit" disabled={isSigningIn}>
            {isSigningIn ? 'Ingresando...' : 'Entrar'}
            {!isSigningIn && <span aria-hidden="true">→</span>}
          </button>
        </form>
      </section>
    </main>
  )
}

export default LoginView
