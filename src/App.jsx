import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { sanitizeSectionHtml } from './sanitizeSectionHtml.js'
import AuthenticatedView from './AuthenticatedView.jsx'
import LoginView from './LoginView.jsx'
import './App.css'
import loadingGif from './assets/loading.gif';

const getSectionKey = (viewId, sectionId) => `${viewId}:${sectionId}`
const getSectionElementId = (viewId, sectionId) => `section-${viewId}-${sectionId}`
const CompanyId = import.meta.env.VITE_COMPANY_ID;
const isAdminPath = (pathname) => /^\/admin\/?$/.test(pathname)
const normalizeSectionImages = (images) => (
  Array.isArray(images)
    ? images.flatMap((image) => {
      if (typeof image === 'string' && image.trim()) {
        return [{ title: '', url: image.trim() }]
      }
      if (image && typeof image === 'object' && typeof image.url === 'string' && image.url.trim()) {
        return [{ title: typeof image.title === 'string' ? image.title : '', url: image.url.trim() }]
      }
      return []
    })
    : []
)

const getPointerDistance = (first, second) => Math.hypot(second.x - first.x, second.y - first.y)
const clampZoom = (scale) => Math.min(5, Math.max(1, scale))

function App() {
  const [views, setViews] = useState([])
  const [activeViewId, setActiveViewId] = useState(null)
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [loadedSections, setLoadedSections] = useState(() => new Set())
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [session, setSession] = useState(null)
  const [isAdminRoute, setIsAdminRoute] = useState(() => isAdminPath(window.location.pathname))
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [lightboxZoom, setLightboxZoom] = useState({ scale: 1, x: 0, y: 0 })
  const lightboxZoomRef = useRef(lightboxZoom)
  const sectionNavigationRef = useRef(false)
  const scrollResumeTimerRef = useRef(null)
  const pendingSectionScrollRef = useRef(null)
  const contentRef = useRef(null)
  const sectionNavRef = useRef(null)
  const lightboxCloseRef = useRef(null)
  const lightboxTriggerRef = useRef(null)
  const lightboxViewportRef = useRef(null)
  const lightboxPointersRef = useRef(new Map())
  const lightboxGestureRef = useRef(null)
  const activeView = views.find((view) => view.id === activeViewId) ?? views[0] ?? null
  const [company, setCompany] = useState({});
  lightboxZoomRef.current = lightboxZoom

  useEffect(() => {
    let active = true
    let authEventReceived = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true
      if (!active) return
      setSession(nextSession)
      setIsAuthLoading(false)
    })

    supabase.auth.getSession()
      .then(({ data: { session: currentSession } }) => {
        if (!active) return
        if (!authEventReceived) setSession(currentSession)
        setIsAuthLoading(false)
      })
      .catch(() => {
        if (active) setIsAuthLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    function handlePopState() {
      setIsAdminRoute(isAdminPath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadViews() {
      const { data, error } = await supabase
        .from('blog_companies')        
        .select(`
          title,
          description,
          logo,
          email,
          address,
          phone,
          blog_views (
            id,
            title,
            description,
            button_title,
            footer,
            position,
            blog_sections (
              id,
              title,
              text,
              button_title,
              images,
              position
            )
          )
        `)
        .eq('id', CompanyId)
        .eq('blog_views.is_active', true)
        .eq('blog_views.blog_sections.is_active', true)
        .order('position', { referencedTable: 'blog_views', ascending: true })
        .order('id', { referencedTable: 'blog_views', ascending: true })
        .order('position', { referencedTable: 'blog_views.blog_sections', ascending: true })
        .order('id', { referencedTable: 'blog_views.blog_sections', ascending: true })
        .maybeSingle(); 
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setIsLoading(false)
        return
      }      
      const loadedViews = (data.blog_views ?? []).map((view) => ({
        id: view.id,
        title: view.title ?? '',
        description: view.description ?? '',
        buttonTitle: view.button_title ?? '',
        sections: (view.blog_sections ?? []).map((section) => ({
          id: section.id,
          title: section.title ?? '',
          text: section.text ?? '',
          buttonTitle: section.button_title ?? '',
          images: normalizeSectionImages(section.images),
        })),
      }));
      delete data.blog_views;
      setCompany(data);
      document.getElementById('___icon').href = data.logo;
      document.getElementById('___title').innerHTML = data.title;
      setViews(loadedViews)
      setActiveViewId(loadedViews[0]?.id ?? null)
      setActiveSectionId(loadedViews[0]?.sections[0]
        ? getSectionKey(loadedViews[0].id, loadedViews[0].sections[0].id)
        : null)
      setIsLoading(false)
    }

    loadViews()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    window.scrollTo({ top: 0, behavior: 'instant' })
    sectionNavRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [activeView])

  useEffect(() => {
    if (!lightboxImage) return undefined

    lightboxPointersRef.current.clear()
    lightboxGestureRef.current = null
    const previousOverflow = document.body.style.overflow
    const viewport = lightboxViewportRef.current
    const handleWheel = (event) => {
      event.preventDefault()
      zoomAtPoint(
        lightboxZoomRef.current.scale + (event.deltaY < 0 ? 0.25 : -0.25),
        event.clientX,
        event.clientY,
      )
    }
    document.body.style.overflow = 'hidden'
    viewport?.addEventListener('wheel', handleWheel, { passive: false })
    lightboxCloseRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setLightboxImage(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      viewport?.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
      if (lightboxTriggerRef.current?.isConnected) lightboxTriggerRef.current.focus()
    }
  }, [lightboxImage])

  function zoomAtPoint(nextScale, clientX, clientY) {
    const viewport = lightboxViewportRef.current
    if (!viewport) return

    const bounds = viewport.getBoundingClientRect()
    const pointX = clientX - bounds.left - bounds.width / 2
    const pointY = clientY - bounds.top - bounds.height / 2
    setLightboxZoom((current) => {
      const scale = clampZoom(nextScale)
      if (scale === 1) return { scale: 1, x: 0, y: 0 }
      const imageX = (pointX - current.x) / current.scale
      const imageY = (pointY - current.y) / current.scale
      return {
        scale,
        x: pointX - imageX * scale,
        y: pointY - imageY * scale,
      }
    })
  }

  function zoomBy(amount) {
    const viewport = lightboxViewportRef.current
    if (!viewport) return
    const bounds = viewport.getBoundingClientRect()
    zoomAtPoint(lightboxZoom.scale + amount, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  }

  function handleLightboxPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const viewport = lightboxViewportRef.current
    if (!viewport) return
    viewport.setPointerCapture(event.pointerId)
    lightboxPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const pointers = [...lightboxPointersRef.current.values()]
    if (pointers.length >= 2) {
      lightboxGestureRef.current = {
        type: 'pinch',
        distance: getPointerDistance(pointers[0], pointers[1]),
        scale: lightboxZoom.scale,
      }
    } else if (lightboxZoom.scale > 1) {
      lightboxGestureRef.current = {
        type: 'pan',
        pointerX: event.clientX,
        pointerY: event.clientY,
        x: lightboxZoom.x,
        y: lightboxZoom.y,
      }
    } else {
      lightboxGestureRef.current = null
    }
  }

  function handleLightboxPointerMove(event) {
    if (!lightboxPointersRef.current.has(event.pointerId)) return
    lightboxPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pointers = [...lightboxPointersRef.current.values()]
    const gesture = lightboxGestureRef.current

    if (pointers.length >= 2 && gesture?.type === 'pinch') {
      const distance = getPointerDistance(pointers[0], pointers[1])
      if (gesture.distance === 0) return
      const scale = clampZoom(gesture.scale * distance / gesture.distance)
      setLightboxZoom((current) => ({ ...current, scale }))
      return
    }

    if (gesture?.type === 'pan' && pointers.length === 1) {
      setLightboxZoom((current) => ({
        ...current,
        x: gesture.x + event.clientX - gesture.pointerX,
        y: gesture.y + event.clientY - gesture.pointerY,
      }))
    }
  }

  function handleLightboxPointerUp(event) {
    lightboxPointersRef.current.delete(event.pointerId)
    lightboxGestureRef.current = null
    if (lightboxPointersRef.current.size === 1 && lightboxZoom.scale > 1) {
      const [pointer] = lightboxPointersRef.current.values()
      lightboxGestureRef.current = {
        type: 'pan',
        pointerX: pointer.x,
        pointerY: pointer.y,
        x: lightboxZoom.x,
        y: lightboxZoom.y,
      }
    }
  }

  useEffect(() => {
    const sectionKey = pendingSectionScrollRef.current
    if (!activeView || !sectionKey || !loadedSections.has(sectionKey)) return undefined

    let cancelled = false

    const scrollAfterLayoutSettles = async () => {
      await document.fonts.ready

      const pageAnimations = contentRef.current
        ?.querySelector('.page-inner')
        ?.getAnimations()
        .filter((animation) => animation.playState === 'running') ?? []
      await Promise.all(pageAnimations.map((animation) => animation.finished.catch(() => undefined)))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      if (cancelled || pendingSectionScrollRef.current !== sectionKey) return

      const sectionData = activeView.sections.find((item) => getSectionKey(activeView.id, item.id) === sectionKey)
      pendingSectionScrollRef.current = null
      const section = sectionData
        ? document.getElementById(getSectionElementId(activeView.id, sectionData.id))
        : null
      if (!section) {
        sectionNavigationRef.current = false
        return
      }

      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    scrollAfterLayoutSettles()
    return () => { cancelled = true }
  }, [activeView, loadedSections])

  useEffect(() => {
    const nav = sectionNavRef.current
    const activeButton = nav?.querySelector('[aria-current="location"]')
    if (!nav || !activeButton) return

    const navBounds = nav.getBoundingClientRect()
    const buttonBounds = activeButton.getBoundingClientRect()
    let top = nav.scrollTop
    let left = nav.scrollLeft

    if (buttonBounds.top < navBounds.top) top += buttonBounds.top - navBounds.top
    else if (buttonBounds.bottom > navBounds.bottom) top += buttonBounds.bottom - navBounds.bottom

    if (buttonBounds.left < navBounds.left) left += buttonBounds.left - navBounds.left
    else if (buttonBounds.right > navBounds.right) left += buttonBounds.right - navBounds.right

    if (top !== nav.scrollTop || left !== nav.scrollLeft) {
      nav.scrollTo({ top, left, behavior: 'smooth' })
    }
  }, [activeSectionId])

  useEffect(() => {
    const content = contentRef.current
    if (!content || isAdminRoute) return undefined

    const updateScrollButton = () => {
      const panelIsScrollable = content.scrollHeight > content.clientHeight + 1
      const scrollPosition = panelIsScrollable ? content.scrollTop : window.scrollY
      setShowScrollTop((isVisible) => {
        const nextVisibility = scrollPosition > 320
        return isVisible === nextVisibility ? isVisible : nextVisibility
      })
    }

    content.addEventListener('scroll', updateScrollButton, { passive: true })
    window.addEventListener('scroll', updateScrollButton, { passive: true })
    updateScrollButton()

    return () => {
      content.removeEventListener('scroll', updateScrollButton)
      window.removeEventListener('scroll', updateScrollButton)
    }
  }, [activeView, isAdminRoute])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return undefined

    const updateActiveSection = () => {
      const sections = [...content.querySelectorAll('[data-active-section]')]
      const lastSectionKey = sections.at(-1)?.dataset.sectionKey
      const contentIsScrollable = content.scrollHeight > content.clientHeight + 1
      const documentIsScrollable = document.documentElement.scrollHeight > window.innerHeight + 1
      const isAtBottom = contentIsScrollable
        ? content.scrollTop + content.clientHeight >= content.scrollHeight - 1
        : documentIsScrollable && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1

      if (isAtBottom && lastSectionKey) {
        setActiveSectionId((currentKey) => currentKey === lastSectionKey ? currentKey : lastSectionKey)
        return
      }

      const readingLine = window.innerHeight * 0.3
      const current = sections.find((section) => {
        const bounds = section.getBoundingClientRect()
        return bounds.top <= readingLine && bounds.bottom >= readingLine
      })
      const previous = sections.filter((section) => section.getBoundingClientRect().top < readingLine).at(-1)
      const nextSectionKey = (current || previous || sections[0])?.dataset.sectionKey
      if (nextSectionKey) setActiveSectionId((currentKey) => currentKey === nextSectionKey ? currentKey : nextSectionKey)
    }

    const handleActiveSectionChange = () => {
      if (!sectionNavigationRef.current) {
        updateActiveSection()
        return
      }

      window.clearTimeout(scrollResumeTimerRef.current)
      scrollResumeTimerRef.current = window.setTimeout(() => {
        sectionNavigationRef.current = false
        scrollResumeTimerRef.current = null
        updateActiveSection()
      }, 160)
    }

    const loadObserver = new IntersectionObserver((entries) => {
      setLoadedSections((current) => {
        const next = new Set(current)
        entries.forEach((entry) => {
          if (entry.isIntersecting) next.add(entry.target.dataset.sectionKey)
        })
        return next
      })
    }, { rootMargin: '320px 0px' })

    const activeObserver = new IntersectionObserver(handleActiveSectionChange, { rootMargin: '-25% 0px -65% 0px' })

    content.querySelectorAll('[data-lazy-section]').forEach((section) => loadObserver.observe(section))
    content.querySelectorAll('[data-active-section]').forEach((section) => activeObserver.observe(section))
    content.addEventListener('scroll', handleActiveSectionChange, { passive: true })
    window.addEventListener('scroll', handleActiveSectionChange, { passive: true })

    return () => {
      loadObserver.disconnect()
      activeObserver.disconnect()
      content.removeEventListener('scroll', handleActiveSectionChange)
      window.removeEventListener('scroll', handleActiveSectionChange)
      window.clearTimeout(scrollResumeTimerRef.current)
    }
  }, [activeView])

  function selectView(viewId) {
    const nextView = views.find((view) => view.id === viewId)
    if (!nextView) return
    sectionNavigationRef.current = false
    window.clearTimeout(scrollResumeTimerRef.current)
    pendingSectionScrollRef.current = null
    setActiveViewId(viewId)
    setActiveSectionId(nextView.sections[0] ? getSectionKey(nextView.id, nextView.sections[0].id) : null)
    setLoadedSections(new Set())
  }

  function handleLoginSuccess(authSession) {
    setSession(authSession)
    navigateToAdmin()
  }

  function cancelLogin() {
    navigateToHome()
  }

  function navigateToAdmin() {
    if(window.innerWidth <= 450) return;
    if (!isAdminPath(window.location.pathname)) {
      window.history.pushState({}, '', '/admin')
    }
    setIsAdminRoute(true)
  }

  function openAdminInNewTab() {
    if (window.innerWidth <= 450) return
    window.open('/admin', '_blank', 'noopener,noreferrer')
  }

  function navigateToHome() {
    if (isAdminPath(window.location.pathname)) {
      window.history.pushState({}, '', '/')
    }
    setIsAdminRoute(false)
  }

  function selectSection(section) {
    const sectionKey = getSectionKey(activeView.id, section.id)
    sectionNavigationRef.current = true
    window.clearTimeout(scrollResumeTimerRef.current)
    scrollResumeTimerRef.current = window.setTimeout(() => {
      sectionNavigationRef.current = false
      scrollResumeTimerRef.current = null
    }, 1500)
    setActiveSectionId(sectionKey)
    pendingSectionScrollRef.current = sectionKey
    const sectionIndex = activeView.sections.findIndex((item) => item.id === section.id)
    setLoadedSections((current) => {
      const next = new Set(current)
      activeView.sections.slice(0, sectionIndex + 1).forEach((item) => {
        next.add(getSectionKey(activeView.id, item.id))
      })
      return next
    })
  }

  function scrollToTop() {
    const content = contentRef.current
    if (content && content.scrollHeight > content.clientHeight + 1) {
      content.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  if (isAdminRoute) {
    if (isAuthLoading) {
      return <main className="data-state" aria-live="polite">Validando sesión...</main>
    }

    if (session) {
      return (
        <AuthenticatedView
          session={session}
          onBack={navigateToHome}
          onSignedOut={() => {
            setSession(null)
            navigateToHome()
          }}
        />
      )
    }

    return <LoginView onBack={cancelLogin} onAuthenticated={handleLoginSuccess} />
  }

  if (isLoading) {
    return (
      <main className="data-state" aria-live="polite">
        <img className="loading-gif" src={loadingGif} alt="Cargando contenido" width="40" />
      </main>
    )
  }
  if (loadError) return <main className="data-state" role="alert">No se pudo cargar el contenido: {loadError}</main>
  if (!activeView) return <main className="data-state">No hay vistas activas para mostrar.</main>

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="brand" type="button" onDoubleClick={openAdminInNewTab} aria-label="Abrir administración">
          {/* <span className="brand-mark" aria-hidden="true">e.</span> */}
          <img src={company.logo} alt="" width={30} />
          <span className="brand-name">{company.title}</span>
        </button>
        <nav className="view-nav" aria-label="Vistas principales" role="tablist">
          {views.map((view, index) => (
            <button
              className={`view-link${view.id === activeViewId ? ' is-active' : ''}`}
              key={view.id}
              type="button"
              role="tab"
              aria-selected={view.id === activeViewId}
              onClick={() => selectView(view.id)}
            >
              <span className="view-index">{String(index + 1).padStart(2, '0')}</span>{view.buttonTitle || view.title}
            </button>
          ))}
        </nav>
        <a href={`mailto:${company.email}?subject=CONSULTA DESDE EL SITIO WEB&body=Hola "${company.title}", me gustaría conocer más sobre ustedes.`} className="topbar-note">
          Escribenos <span aria-hidden="true">↗</span>
        </a>
      </header>

      <div className="workspace">
        <aside className="section-sidebar" aria-label={`Secciones de ${activeView.buttonTitle || activeView.title}`}>
          <div className="sidebar-label">EN ESTA VISTA</div>
          <nav ref={sectionNavRef} aria-label="Secciones">
            {activeView.sections.map((section, index) => {
              const sectionKey = getSectionKey(activeView.id, section.id)
              return (
              <button
                className={`section-link${sectionKey === activeSectionId ? ' is-active' : ''}`}
                key={sectionKey}
                type="button"
                aria-current={sectionKey === activeSectionId ? 'location' : undefined}
                onClick={() => selectSection(section)}
              >
                <span className="section-index">{String(index + 1).padStart(2, '0')}</span>
                <span>{section.buttonTitle || section.title}</span>
              </button>
              )
            })}
          </nav>
          <div className="sidebar-foot"><span className="status-dot" /> {company.title}</div>
        </aside>

        <main className="page-content" ref={contentRef}>
          <div className="page-inner" key={activeView.id}>
            {/* <header className="view-heading">
              <div className="heading-copy">
                <p className="eyebrow"><span className="eyebrow-rule" />{activeView.buttonTitle || 'VISTA'}</p>
                <h1>{activeView.title.split('\n').map((line, index) => <span key={`${index}-${line}`}>{index > 0 && <br />}{line}</span>)}</h1>
                <p className="view-description">{activeView.description}</p>
              </div>
              <div className="heading-aside" aria-hidden="true">
                <span className="aside-number">{String(views.indexOf(activeView) + 1).padStart(2, '0')}</span>
                <span className="aside-caption">Mostrando<br />Contenido</span>
              </div>
              <div className="heading-bottom"><span>DESLIZA PARA EXPLORAR</span><span className="down-arrow" aria-hidden="true">↓</span></div>
            </header> */}

            <div className="section-list">
              {activeView.sections.map((section, index) => {
                const sectionKey = getSectionKey(activeView.id, section.id)
                return (
                <section className="content-section" id={getSectionElementId(activeView.id, section.id)} key={sectionKey} data-section-key={sectionKey} data-lazy-section data-active-section>
                  <div className="section-meta"><span>{String(index + 1).padStart(2, '0')} / {String(activeView.sections.length).padStart(2, '0')}</span><span>{(activeView.buttonTitle || activeView.title).toUpperCase()}</span></div>
                  <div className="section-body">
                    <div className="section-copy">
                      <p className="section-kicker">SECCIÓN {String(index + 1).padStart(2, '0')}</p>
                      <h2>{section.title}</h2>
                      {loadedSections.has(sectionKey)
                        ? <div className='section-text'
                                dangerouslySetInnerHTML={{
                                    __html: sanitizeSectionHtml(section.text)
                                }}
                            />
                        : <div className="text-placeholder" aria-hidden="true"><span /><span /><span /></div>}
                    </div>
                    {loadedSections.has(sectionKey) && section.images.length > 0 && (
                      <div className={`section-gallery section-gallery--${section.images.length}`}>                        
                        {section.images.map((image, imageIndex) => (
                          <figure className="section-image" key={`${sectionKey}:image:${imageIndex}`}>
                            <button
                              className="section-image-button"
                              type="button"
                              aria-label={`Ampliar imagen ${imageIndex + 1} de ${section.title}`}
                              onClick={(event) => {
                                lightboxTriggerRef.current = event.currentTarget
                                setLightboxZoom({ scale: 1, x: 0, y: 0 })
                                setLightboxImage({
                                  src: image.url,
                                  alt: image.title || `${section.title} - imagen ${imageIndex + 1}`,
                                })
                              }}
                            >
                              <img
                                src={image.url}
                                alt={image.title || `${section.title} - imagen ${imageIndex + 1}`}
                                loading="lazy"
                              />
                            </button>
                            <figcaption><span>{image.title || section.title}</span><span>{imageIndex + 1} / {section.images.length}</span></figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
                )
              })}
            </div>
            <footer className="page-footer">
              <div className="footer-contact">
                <div className="footer-field">
                  <span className="footer-label">CORREO</span>
                  <a href={`mailto:${company.email}?subject=CONSULTA DESDE EL SITIO WEB&body=Hola "${company.title}", me gustaría conocer más sobre ustedes.`}>{company.email}</a>
                </div>
                <div className="footer-field">
                  <span className="footer-label">DIRECCIÓN</span>
                  <address>{company.address}</address>
                </div>
              </div>
              <a
                className="footer-whatsapp"
                href={`whatsapp://send?phone=${company.phone}&text=Hola *${company.title}*, me gustaría conocer más sobre ustedes.`}
                target="_blank"
                rel="noreferrer"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.133-.137.298-.322.446-.495.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.51-.173-.008-.372-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.437-9.884 9.888-9.884 2.64.001 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.993c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.304-1.654a11.882 11.882 0 005.684 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
                Escríbenos 
              </a>
              <div className="footer-bottom">
                <span>© {new Date().getFullYear()} {company.title}. Todos los derechos reservados.</span>
                <span>Soluciones informaticas: jp_nolasco@outlook.com <span aria-hidden="true">✳</span></span>
              </div>
            </footer>
          </div>
        </main>
      </div>
      {lightboxImage && (
        <div
          className="lightbox-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxImage(null)
          }}
        >
          <div className="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Imagen ampliada">
            <button
              ref={lightboxCloseRef}
              className="lightbox-close"
              type="button"
              aria-label="Cerrar imagen ampliada"
              onClick={() => setLightboxImage(null)}
            >
              <span aria-hidden="true">×</span>
            </button>
              <div
                ref={lightboxViewportRef}
                className={`lightbox-viewport${lightboxZoom.scale > 1 ? ' is-zoomed' : ''}`}
                onPointerDown={handleLightboxPointerDown}
                onPointerMove={handleLightboxPointerMove}
                onPointerUp={handleLightboxPointerUp}
                onPointerCancel={handleLightboxPointerUp}
                onDoubleClick={(event) => {
                  const bounds = lightboxViewportRef.current?.getBoundingClientRect()
                  if (bounds) {
                    const nextScale = lightboxZoom.scale > 1 ? 1 : 2
                    zoomAtPoint(nextScale, event.clientX, event.clientY)
                  }
                }}
                onDragStart={(event) => event.preventDefault()}
              >
                <img
                  className="lightbox-image"
                  src={lightboxImage.src}
                  alt={lightboxImage.alt}
                  draggable="false"
                  style={{
                    '--lightbox-zoom': lightboxZoom.scale,
                    '--lightbox-x': `${lightboxZoom.x}px`,
                    '--lightbox-y': `${lightboxZoom.y}px`,
                  }}
                />
              </div>
              <div className="lightbox-zoom-controls" aria-label="Controles de zoom">
                <button type="button" onClick={() => zoomBy(0.5)} disabled={lightboxZoom.scale >= 5} aria-label="Acercar" title="Acercar">+</button>
                <span aria-live="polite">{Math.round(lightboxZoom.scale * 100)}%</span>
                <button type="button" onClick={() => zoomBy(-0.5)} disabled={lightboxZoom.scale <= 1} aria-label="Alejar" title="Alejar">−</button>
                <button type="button" onClick={() => setLightboxZoom({ scale: 1, x: 0, y: 0 })} disabled={lightboxZoom.scale === 1} aria-label="Restablecer zoom" title="Restablecer zoom">↺</button>
              </div>
            </div>
        </div>
      )}
      {showScrollTop && (
        <button className="scroll-to-top" type="button" onClick={scrollToTop} aria-label="Volver arriba" title="Volver arriba">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default App
