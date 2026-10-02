import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { sanitizeSectionHtml } from './sanitizeSectionHtml.js'
import './BlogContentManager.css'

const RichTextEditor = lazy(() => import('./RichTextEditor.jsx'))
const companyId = import.meta.env.VITE_COMPANY_ID?.trim()

const emptyViewForm = {
  title: '',
  description: '',
  buttonTitle: '',
  footer: '',
  isActive: true,
}

const emptySectionForm = {
  title: '',
  text: '',
  buttonTitle: '',
  isActive: true,
}

async function compressImage(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('No se pudo abrir la imagen seleccionada para comprimirla.')
  }

  const maxDimension = 1920
  const scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('El navegador no pudo preparar la imagen para comprimirla.')
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const compressedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('El navegador no pudo comprimir la imagen seleccionada.'))
    }, 'image/webp', 0.82)
  })

  if (compressedBlob.size >= file.size && scale === 1) return file

  const extension = compressedBlob.type === 'image/webp' ? '.webp' : compressedBlob.type === 'image/jpeg' ? '.jpg' : '.png'
  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([compressedBlob], `${baseName}${extension}`, {
    type: compressedBlob.type,
    lastModified: Date.now(),
  })
}

async function convertImageToPng(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('No se pudo abrir la imagen seleccionada para convertirla a PNG.')
  }

  const maxDimension = 256
  const scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('El navegador no pudo preparar el logo.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('El navegador no pudo convertir el logo a PNG.'))
    }, 'image/png')
  })
  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([pngBlob], `${baseName}.png`, { type: 'image/png', lastModified: Date.now() })
}

const normalizeImages = (images) => (
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

function getImagesBucketPath(imageUrl) {
  try {
    const parsedUrl = new URL(imageUrl)
    const configuredUrl = new URL(import.meta.env.VITE_SUPABASE_URL)
    const publicBucketPath = '/storage/v1/object/public/images/'
    if (parsedUrl.origin !== configuredUrl.origin || !parsedUrl.pathname.includes(publicBucketPath)) return null
    return decodeURIComponent(parsedUrl.pathname.split(publicBucketPath)[1])
  } catch {
    return null
  }
}

const emptyCompanyForm = {
  title: '',
  description: '',
  logo: '',
  email: '',
  address: '',
  phone: '',
}

function requireCompanyId() {
  if (!companyId) throw new Error('Falta configurar VITE_COMPANY_ID en el archivo .env.')
  return companyId
}

async function fetchBlogContent() {
  const id = requireCompanyId()
  const viewsResult = await supabase
    .from('blog_views')
    .select('id,title,description,button_title,footer,is_active,position')
    .eq('company_id', id)
    .order('position', { ascending: true })
    .order('id', { ascending: true })

  if (viewsResult.error) throw viewsResult.error

  const viewIds = (viewsResult.data ?? []).map((view) => view.id)
  if (viewIds.length === 0) {
    return { views: [], sections: [] }
  }

  const sectionsResult = await supabase
    .from('blog_sections')
    .select('id,title,text,button_title,images,view_id,is_active,position')
    .in('view_id', viewIds)
    .order('position', { ascending: true })
    .order('id', { ascending: true })

  if (sectionsResult.error) throw sectionsResult.error

  return {
    views: viewsResult.data ?? [],
    sections: sectionsResult.data ?? [],
  }
}

async function fetchCompanyRecord() {
  const id = requireCompanyId()
  const { data, error } = await supabase
    .from('blog_companies')
    .select('id,title,description,logo,email,address,phone')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`No se encontró la empresa con ID ${id}.`)

  return data
}

function BlogContentManager({ userEmail }) {
  const [views, setViews] = useState([])
  const [sections, setSections] = useState([])
  const [selectedViewId, setSelectedViewId] = useState('')
  const [activeTab, setActiveTab] = useState('views')
  const [viewForm, setViewForm] = useState({ ...emptyViewForm })
  const [sectionForm, setSectionForm] = useState({ ...emptySectionForm })
  const [companyForm, setCompanyForm] = useState({ ...emptyCompanyForm })
  const [companyLogoFile, setCompanyLogoFile] = useState(null)
  const [companyRecordId, setCompanyRecordId] = useState(null)
  const [isCompanyLoading, setIsCompanyLoading] = useState(true)
  const [companyErrorMessage, setCompanyErrorMessage] = useState('')
  const [editingViewId, setEditingViewId] = useState(null)
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [imageManagerSectionId, setImageManagerSectionId] = useState(null)
  const [imageTitle, setImageTitle] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imageTitleEdits, setImageTitleEdits] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchBlogContent()
      .then(({ views: loadedViews, sections: loadedSections }) => {
        if (cancelled) return
        setViews(loadedViews)
        setSections(loadedSections)
        const firstActiveView = loadedViews.find((view) => view.is_active)
        setSelectedViewId(firstActiveView ? String(firstActiveView.id) : '')
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error.message || 'No se pudo cargar el contenido.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchCompanyRecord()
      .then((company) => {
        if (cancelled) return
        setCompanyRecordId(company.id)
        setCompanyForm({
          title: company.title,
          description: company.description,
          logo: company.logo,
          email: company.email,
          address: company.address,
          phone: company.phone,
        })
        setCompanyLogoFile(null)
        setCompanyErrorMessage('')
      })
      .catch((error) => {
        if (!cancelled) setCompanyErrorMessage(error.message || 'No se pudo cargar la empresa.')
      })
      .finally(() => {
        if (!cancelled) setIsCompanyLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  async function refreshData() {
    try {
      const [{ views: loadedViews, sections: loadedSections }, company] = await Promise.all([
        fetchBlogContent(),
        fetchCompanyRecord(),
      ])
      setViews(loadedViews)
      setSections(loadedSections)
      setSelectedViewId((currentId) => (
        loadedViews.some((view) => view.is_active && String(view.id) === currentId)
          ? currentId
          : String(loadedViews.find((view) => view.is_active)?.id ?? '')
      ))
      setCompanyRecordId(company.id)
      setCompanyForm({
        title: company.title,
        description: company.description,
        logo: company.logo,
        email: company.email,
        address: company.address,
        phone: company.phone,
      })
      setCompanyLogoFile(null)
      setCompanyErrorMessage('')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'No se pudieron actualizar los datos.')
    }
  }

  async function saveCompany(event) {
    event.preventDefault()
    if (companyRecordId === null) return
    if (companyLogoFile && !companyLogoFile.type.startsWith('image/')) {
      setErrorMessage('Selecciona un archivo de imagen válido para el logo.')
      return
    }

    const payload = {
      title: companyForm.title.trim(),
      description: companyForm.description.trim(),
      logo: companyForm.logo.trim(),
      email: companyForm.email.trim(),
      address: companyForm.address.trim(),
      phone: companyForm.phone.trim(),
    }

    const previousLogoPath = getImagesBucketPath(payload.logo)
    let uploadedLogoPath = null
    const saved = await runMutation('Datos de empresa actualizados.', async () => {
      let nextPayload = payload
      if (companyLogoFile) {
        const pngFile = await convertImageToPng(companyLogoFile)
        const safeName = pngFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        uploadedLogoPath = `${requireCompanyId()}/company/logo/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('images').upload(uploadedLogoPath, pngFile, {
          contentType: 'image/png',
        })
        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(uploadedLogoPath)
        nextPayload = { ...payload, logo: publicUrlData.publicUrl }
      }

      const { error } = await supabase.from('blog_companies')
        .update(nextPayload)
        .eq('id', requireCompanyId())
      if (error) {
        if (uploadedLogoPath) {
          const { error: cleanupError } = await supabase.storage.from('images').remove([uploadedLogoPath])
          if (cleanupError) {
            throw new Error(`${error.message}. También falló la limpieza del nuevo logo: ${cleanupError.message}`)
          }
          uploadedLogoPath = null
        }
        throw error
      }
      Object.assign(payload, nextPayload)
      return { error: null }
    })

    if (saved) {
      setCompanyForm(payload)
      setCompanyLogoFile(null)
      const logoInput = document.getElementById('company-logo-file')
      if (logoInput) logoInput.value = ''

      if (uploadedLogoPath && previousLogoPath && previousLogoPath !== uploadedLogoPath) {
        const { error } = await supabase.storage.from('images').remove([previousLogoPath])
        if (error) {
          setSuccessMessage('')
          setErrorMessage(`El logo se actualizó, pero no se pudo borrar el archivo anterior: ${error.message}`)
        }
      }
    }
  }

  async function runMutation(successText, operation) {
    setErrorMessage('')
    setSuccessMessage('')
    setIsSaving(true)

    try {
      const { error } = await operation()
      if (error) throw error
      await refreshData()
      setSuccessMessage(successText)
      return true
    } catch (error) {
      setErrorMessage(error.message || 'No se pudo guardar el cambio.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function saveView(event) {
    event.preventDefault()
    const nextPosition = views.length > 0
      ? (views[views.length - 1].position ?? 0) + 1
      : 1
    const payload = {
      title: viewForm.title.trim(),
      description: viewForm.description.trim(),
      button_title: viewForm.buttonTitle.trim(),
      footer: viewForm.footer.trim() || null,
      is_active: viewForm.isActive,
    }
    const operation = () => editingViewId
      ? supabase.from('blog_views').update(payload).eq('id', editingViewId).eq('company_id', requireCompanyId())
      : supabase.from('blog_views').insert({
        ...payload,
        position: nextPosition,
        company_id: requireCompanyId(),
      })

    if (await runMutation(editingViewId ? 'Vista actualizada.' : 'Vista creada.', operation)) {
      setViewForm({ ...emptyViewForm })
      setEditingViewId(null)
    }
  }

  async function saveSection(event) {
    event.preventDefault()
    const savedViewId = selectedViewId
    const nextPosition = visibleSections.length > 0
      ? (visibleSections[visibleSections.length - 1].position ?? 0) + 1
      : 1
    const payload = {
      view_id: savedViewId,
      title: sectionForm.title.trim(),
      text: sanitizeSectionHtml(sectionForm.text),
      button_title: sectionForm.buttonTitle.trim(),
      is_active: sectionForm.isActive,
    }
    const operation = () => editingSectionId
      ? supabase.from('blog_sections').update(payload).eq('id', editingSectionId).eq('company_id', requireCompanyId())
      : supabase.from('blog_sections').insert({
        ...payload,
        images: [],
        position: nextPosition,
        company_id: requireCompanyId(),
      })

    if (await runMutation(editingSectionId ? 'Sección actualizada.' : 'Sección creada.', operation)) {
      setSectionForm({ ...emptySectionForm })
      setEditingSectionId(null)
      setImageManagerSectionId(null)
    }
  }

  function selectSectionView(viewId) {
    setSelectedViewId(viewId)
    setSectionForm({ ...emptySectionForm })
    setEditingSectionId(null)
    setImageManagerSectionId(null)
    setErrorMessage('')
    setSuccessMessage('')
  }

  async function moveSection(section, direction) {
    const currentIndex = visibleSections.findIndex((item) => String(item.id) === String(section.id))
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= visibleSections.length) return

    const reorderedSections = [...visibleSections]
    reorderedSections.splice(currentIndex, 1)
    reorderedSections.splice(nextIndex, 0, section)

    const succeeded = await runMutation(
      'Orden de secciones actualizado.',
      async () => {
        const company = requireCompanyId()
        const updateErrors = []

        for (const [index, orderedSection] of reorderedSections.entries()) {
          const { error } = await supabase
            .from('blog_sections')
            .update({ position: index + 1 })
            .eq('id', orderedSection.id)
            .eq('company_id', company)

          if (error) updateErrors.push(`${orderedSection.title || orderedSection.id}: ${error.message}`)
        }

        return {
          error: updateErrors.length > 0
            ? new Error(`No se pudieron actualizar todas las posiciones: ${updateErrors.join('; ')}`)
            : null,
        }
      },
    )

    if (!succeeded) {
      try {
        const { sections: loadedSections } = await fetchBlogContent()
        setSections(loadedSections)
      } catch (error) {
        setErrorMessage((message) => `${message} No se pudo refrescar la lista: ${error.message || 'error desconocido'}`)
      }
    }
  }

  async function moveView(view, direction) {
    const currentIndex = views.findIndex((item) => String(item.id) === String(view.id))
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= views.length) return

    const reorderedViews = [...views]
    reorderedViews.splice(currentIndex, 1)
    reorderedViews.splice(nextIndex, 0, view)

    const succeeded = await runMutation(
      'Orden de vistas actualizado.',
      async () => {
        const company = requireCompanyId()
        const updateErrors = []

        for (const [index, orderedView] of reorderedViews.entries()) {
          const { error } = await supabase
            .from('blog_views')
            .update({ position: index + 1 })
            .eq('id', orderedView.id)
            .eq('company_id', company)

          if (error) updateErrors.push(`${orderedView.title || orderedView.id}: ${error.message}`)
        }

        return {
          error: updateErrors.length > 0
            ? new Error(`No se pudieron actualizar todas las posiciones: ${updateErrors.join('; ')}`)
            : null,
        }
      },
    )

    if (!succeeded) {
      try {
        const { views: loadedViews } = await fetchBlogContent()
        setViews(loadedViews)
      } catch (error) {
        setErrorMessage((message) => `${message} No se pudo refrescar la lista: ${error.message || 'error desconocido'}`)
      }
    }
  }

  async function toggleViewStatus(view) {
    await runMutation(
      view.is_active ? 'Vista desactivada.' : 'Vista activada.',
      () => supabase.from('blog_views').update({ is_active: !view.is_active })
        .eq('id', view.id)
        .eq('company_id', requireCompanyId()),
    )
  }

  async function toggleSectionStatus(section) {
    await runMutation(
      section.is_active ? 'Sección desactivada.' : 'Sección activada.',
      () => supabase.from('blog_sections').update({ is_active: !section.is_active }).eq('id', section.id),
    )
  }

  async function deleteView(view) {
    const confirmed = window.confirm(`¿Eliminar “${view.title}” y todas sus secciones? Esta acción no se puede deshacer.`)
    if (!confirmed) return
    await runMutation(
      'Vista eliminada.',
      () => supabase.from('blog_views').delete().eq('id', view.id).eq('company_id', requireCompanyId()),
    )
    if (String(view.id) === selectedViewId) setSectionForm({ ...emptySectionForm })
  }

  async function deleteSection(section) {
    if (!window.confirm(`¿Eliminar la sección “${section.title}”? Esta acción no se puede deshacer.`)) return
    const deleted = await runMutation('Sección eliminada.', () => supabase.from('blog_sections').delete().eq('id', section.id))
    if (!deleted) return
    setSectionForm({ ...emptySectionForm })
    setEditingSectionId(null)
    setImageManagerSectionId(null)
    setImageTitle('')
    setImageFile(null)
    setImageTitleEdits({})
    const fileInput = document.getElementById('section-image-file')
    if (fileInput) fileInput.value = ''

    const storagePaths = normalizeImages(section.images)
      .map((image) => getImagesBucketPath(image.url))
      .filter(Boolean)
    if (storagePaths.length > 0) {
      const { error } = await supabase.storage.from('images').remove(storagePaths)
      if (error) {
        setSuccessMessage('')
        setErrorMessage(`La sección se eliminó, pero no se pudieron borrar todas sus imágenes del bucket: ${error.message}`)
      }
    }
  }

  async function addSectionImage(event, section) {
    event.preventDefault()
    if (!imageFile || !imageTitle.trim()) return
    if (!imageFile.type.startsWith('image/')) {
      setErrorMessage('Selecciona un archivo de imagen válido.')
      return
    }

    const saved = await runMutation('Imagen agregada.', async () => {
      const compressedFile = await compressImage(imageFile)
      const safeFileName = compressedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const storagePath = `${requireCompanyId()}/blog-sections/${section.id}/${crypto.randomUUID()}-${safeFileName}`
      const { error: uploadError } = await supabase.storage.from('images').upload(storagePath, compressedFile)
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(storagePath)
      const nextImages = [
        ...normalizeImages(section.images),
        { title: imageTitle.trim(), url: publicUrlData.publicUrl },
      ]
      const result = await supabase.from('blog_sections')
        .update({ images: nextImages })
        .eq('id', section.id)
        .eq('company_id', requireCompanyId())

      if (result.error) {
        const { error: cleanupError } = await supabase.storage.from('images').remove([storagePath])
        if (cleanupError) {
          throw new Error(`${result.error.message}. También falló la limpieza del archivo subido: ${cleanupError.message}`)
        }
        throw result.error
      }
      return result
    })
    if (saved) {
      setImageTitle('')
      setImageFile(null)
      const fileInput = document.getElementById('section-image-file')
      if (fileInput) fileInput.value = ''
    }
  }

  async function saveImageTitle(section, imageIndex) {
    const images = normalizeImages(section.images)
    const editKey = `${section.id}:${imageIndex}`
    const nextTitle = (imageTitleEdits[editKey] ?? images[imageIndex].title).trim()
    const nextImages = images.map((image, index) => (
      index === imageIndex ? { ...image, title: nextTitle } : image
    ))
    if (await runMutation('Título de imagen actualizado.', () => supabase.from('blog_sections')
      .update({ images: nextImages })
      .eq('id', section.id)
      .eq('company_id', requireCompanyId()))) {
      setImageTitleEdits((current) => {
        const next = { ...current }
        delete next[editKey]
        return next
      })
    }
  }

  async function deleteSectionImage(section, imageIndex) {
    const images = normalizeImages(section.images)
    const image = images[imageIndex]
    if (!image || !window.confirm(`¿Eliminar la imagen “${image.title || `#${imageIndex + 1}`}” de esta sección?`)) return
    const nextImages = images.filter((_, index) => index !== imageIndex)
    const storagePath = getImagesBucketPath(image.url)

    if (!await runMutation('Imagen eliminada de la sección.', () => supabase.from('blog_sections')
      .update({ images: nextImages })
      .eq('id', section.id)
      .eq('company_id', requireCompanyId()))) return

    if (storagePath) {
      const { error } = await supabase.storage.from('images').remove([storagePath])
      if (error) {
        setSuccessMessage('')
        setErrorMessage(`La imagen se quitó de la sección, pero no se pudo borrar del bucket: ${error.message}`)
      }
    }
  }

  function editView(view) {
    setEditingViewId(view.id)
    setViewForm({
      title: view.title ?? '',
      description: view.description ?? '',
      buttonTitle: view.button_title ?? '',
      footer: view.footer ?? '',
      isActive: view.is_active,
    })
    setErrorMessage('')
    setSuccessMessage('')
  }

  function editSection(section) {
    setImageManagerSectionId(section.id)
    setImageTitle('')
    setImageFile(null)
    setEditingSectionId(section.id)
    setSectionForm({
      title: section.title ?? '',
      text: section.text ?? '',
      buttonTitle: section.button_title ?? '',
      isActive: section.is_active,
    })
    setErrorMessage('')
    setSuccessMessage('')
  }

  function resetViewForm() {
    setViewForm({ ...emptyViewForm })
    setEditingViewId(null)
    setErrorMessage('')
    setSuccessMessage('')
  }

  function resetSectionForm() {
    setSectionForm({ ...emptySectionForm })
    setEditingSectionId(null)
    setImageManagerSectionId(null)
    setErrorMessage('')
    setSuccessMessage('')
  }

  const activeViews = views.filter((view) => view.is_active)
  const visibleSections = sections.filter((section) => String(section.view_id) === selectedViewId)
  const imageManagerSection = visibleSections.find((section) => String(section.id) === String(imageManagerSectionId))
  const viewNames = new Map(views.map((view) => [String(view.id), view.title]))

  if (isLoading) return <section className="manager-state" aria-live="polite">Cargando tablas...</section>

  return (
    <section className="content-manager" aria-labelledby="manager-title">
      <header className="manager-heading">
        <div>
          {/* <p className="manager-kicker">ADMINISTRACIÓN</p> */}
          <div className="manager-title-row">
            <h4 id="manager-title">Contenido del sitio</h4>
            {userEmail && <span className="manager-user" title={userEmail}>{userEmail}</span>}
          </div>
          <p>Gestiona las vistas y sus secciones.</p>
        </div>
        <button className="manager-refresh" type="button" onClick={refreshData} disabled={isSaving}>
          Actualizar datos
        </button>
      </header>

      <div className="manager-tabs" role="tablist" aria-label="Tablas de contenido">
        <button className={activeTab === 'views' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'views'} onClick={() => setActiveTab('views')}>
          Vistas <span>{views.length}</span>
        </button>
        <button className={activeTab === 'sections' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'sections'} onClick={() => setActiveTab('sections')}>
          Secciones <span>{sections.length}</span>
        </button>
        <button className={activeTab === 'company' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'company'} onClick={() => setActiveTab('company')}>
          Empresa
        </button>
      </div>

      {errorMessage && <p className="manager-message manager-message--error" role="alert">{errorMessage}</p>}
      {successMessage && <p className="manager-message manager-message--success" role="status">{successMessage}</p>}

      {activeTab === 'views' ? (
        <div className="manager-layout">
          <form className="manager-form" onSubmit={saveView}>
            <div className="manager-form-heading">
              <h3>{editingViewId ? 'Editar vista' : 'Nueva vista'}</h3>
              {editingViewId && <button type="button" className="manager-text-button" onClick={resetViewForm}>Cancelar edición</button>}
            </div>
            <label>Empresa ID<input value={companyId || ''} readOnly aria-readonly="true" /></label>
            <label>Título<input value={viewForm.title} onChange={(event) => setViewForm({ ...viewForm, title: event.target.value })} maxLength={100} required /></label>
            <label>Descripción<textarea value={viewForm.description} onChange={(event) => setViewForm({ ...viewForm, description: event.target.value })} maxLength={300} rows={3} required /></label>
            <label>Texto del navbar<input value={viewForm.buttonTitle} onChange={(event) => setViewForm({ ...viewForm, buttonTitle: event.target.value })} maxLength={45} required /></label>
            <label>Footer<input value={viewForm.footer} onChange={(event) => setViewForm({ ...viewForm, footer: event.target.value })} maxLength={100} /></label>
            <label className="manager-checkbox"><input type="checkbox" checked={viewForm.isActive} onChange={(event) => setViewForm({ ...viewForm, isActive: event.target.checked })} /> Vista activa</label>
            <button className="manager-primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando...' : editingViewId ? 'Guardar cambios' : 'Crear vista'}</button>
          </form>

          <div className="manager-list">
            <div className="manager-list-heading"><h3>Vistas registradas</h3><span>{views.length} registros</span></div>
            {views.length === 0 && <p className="manager-empty">Todavía no hay vistas.</p>}
            {views.map((view, index) => (
              <article
                className={`manager-row${String(editingViewId) === String(view.id) ? ' is-editing' : ''}`}
                key={view.id}
                aria-current={String(editingViewId) === String(view.id) ? 'true' : undefined}
              >
                <div className="manager-row-copy">
                  <div className="manager-row-title"><h4>{view.title}</h4><span className={view.is_active ? 'manager-status' : 'manager-status is-inactive'}>{view.is_active ? 'Activa' : 'Inactiva'}</span></div>
                  <p>{view.description}</p>
                  <small>ID {view.id} · {sections.filter((section) => String(section.view_id) === String(view.id)).length} secciones</small>
                </div>
                <div className="manager-row-actions">
                  <button
                    type="button"
                    onClick={() => moveView(view, -1)}
                    disabled={isSaving || index === 0}
                    aria-label={`Mover ${view.title || 'vista'} hacia arriba`}
                    title="Mover hacia arriba"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveView(view, 1)}
                    disabled={isSaving || index === views.length - 1}
                    aria-label={`Mover ${view.title || 'vista'} hacia abajo`}
                    title="Mover hacia abajo"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => editView(view)} disabled={isSaving}>Editar</button>
                  <button type="button" onClick={() => toggleViewStatus(view)} disabled={isSaving}>{view.is_active ? 'Desactivar' : 'Activar'}</button>
                  <button className="is-danger" type="button" onClick={() => deleteView(view)} disabled={isSaving}>Eliminar</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : activeTab === 'sections' ? (
        <div className="manager-layout manager-layout--sections">
          <form className="manager-form" onSubmit={saveSection}>
            <div className="manager-form-heading">
              <h3>{editingSectionId ? 'Editar sección' : 'Nueva sección'}</h3>
              {editingSectionId && <button type="button" className="manager-text-button" onClick={resetSectionForm}>Cancelar edición</button>}
            </div>
            <label>Título<input value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} maxLength={100}  /></label>
            <div className="manager-rich-field">
              <span id="section-text-label">Texto / contenido</span>
              <Suspense fallback={<div className="rich-text-editor rich-text-editor--loading" aria-busy="true">Cargando editor...</div>}>
                <RichTextEditor value={sectionForm.text} onChange={(text) => setSectionForm({ ...sectionForm, text })} />
              </Suspense>
            </div>
            <label>Texto del navbar<input value={sectionForm.buttonTitle} onChange={(event) => setSectionForm({ ...sectionForm, buttonTitle: event.target.value })} maxLength={45} required /></label>
            <label className="manager-checkbox"><input type="checkbox" checked={sectionForm.isActive} onChange={(event) => setSectionForm({ ...sectionForm, isActive: event.target.checked })} /> Sección activa</label>
            <button className="manager-primary-button" type="submit" disabled={isSaving || activeViews.length === 0}>{isSaving ? 'Guardando...' : editingSectionId ? 'Guardar cambios' : 'Crear sección'}</button>
          </form>

          <div className="manager-list">
            <div className="manager-list-heading manager-section-filter">
              <h3>Secciones registradas</h3>
              <select aria-label="Filtrar secciones por vista" value={selectedViewId} onChange={(event) => {
                selectSectionView(event.target.value)
              }} disabled={activeViews.length === 0}>
                {activeViews.map((view) => <option key={view.id} value={view.id}>{view.title}</option>)}
              </select>
            </div>
            {activeViews.length === 0 ? (
              <p className="manager-empty">No hay vistas activas para mostrar.</p>
            ) : visibleSections.length === 0 && <p className="manager-empty">Esta vista todavía no tiene secciones.</p>}
            {visibleSections.map((section, index) => (
              <article
                className={`manager-row${String(editingSectionId) === String(section.id) ? ' is-editing' : ''}`}
                key={section.id}
                aria-current={String(editingSectionId) === String(section.id) ? 'true' : undefined}
              >
                <div className="manager-row-copy">
                  <div className="manager-row-title"><h4>{section.title}</h4><span className={section.is_active ? 'manager-status' : 'manager-status is-inactive'}>{section.is_active ? 'Activa' : 'Inactiva'}</span></div>
                  <p>{section.button_title} · {normalizeImages(section.images).length} imágenes</p>
                  <small>ID {section.id} · {viewNames.get(String(section.view_id)) ?? `Vista ${section.view_id}`}</small>
                </div>
                <div className="manager-row-actions">
                  <button
                    type="button"
                    onClick={() => moveSection(section, -1)}
                    disabled={isSaving || index === 0}
                    aria-label={`Mover ${section.title || 'sección'} hacia arriba`}
                    title="Mover hacia arriba"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(section, 1)}
                    disabled={isSaving || index === visibleSections.length - 1}
                    aria-label={`Mover ${section.title || 'sección'} hacia abajo`}
                    title="Mover hacia abajo"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => editSection(section)} disabled={isSaving}>Editar</button>
                  <button type="button" onClick={() => toggleSectionStatus(section)} disabled={isSaving}>{section.is_active ? 'Desactivar' : 'Activar'}</button>
                  <button className="is-danger" type="button" onClick={() => deleteSection(section)} disabled={isSaving}>Eliminar</button>
                </div>
              </article>
            ))}
            {imageManagerSection && (
              <section className="manager-image-panel" aria-labelledby="manager-images-title">
                <div className="manager-list-heading">
                  <div>
                    <h3 id="manager-images-title">Imágenes de {imageManagerSection.title || 'esta sección'}</h3>
                    {/* <span>Se comprimen antes de guardarse en el bucket “images” (máximo 1920 px).</span> */}
                  </div>
                  <button className="manager-text-button" type="button" onClick={() => setImageManagerSectionId(null)}>Cerrar</button>
                </div>
                <form className="manager-image-upload" onSubmit={(event) => addSectionImage(event, imageManagerSection)}>
                  <label>Título de imagen<input value={imageTitle} onChange={(event) => setImageTitle(event.target.value)} maxLength={120} required /></label>
                  <label>Archivo de imagen<input id="section-image-file" type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} required /></label>
                  <button
                    className="manager-primary-button manager-image-upload-button"
                    type="submit"
                    disabled={isSaving || !imageFile}
                    aria-label={isSaving ? 'Comprimiendo y subiendo imagen' : 'Subir imagen'}
                    title={isSaving ? 'Comprimiendo y subiendo imagen' : 'Subir imagen'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" />
                    </svg>
                    <span className="manager-visually-hidden">{isSaving ? 'Comprimiendo y subiendo imagen' : 'Subir imagen'}</span>
                  </button>
                </form>
                {normalizeImages(imageManagerSection.images).length === 0 ? (
                  <p className="manager-empty">Esta sección todavía no tiene imágenes.</p>
                ) : (
                  <div className="manager-image-list">
                    {normalizeImages(imageManagerSection.images).map((image, imageIndex) => {
                      const editKey = `${imageManagerSection.id}:${imageIndex}`
                      const currentTitle = imageTitleEdits[editKey] ?? image.title
                      return (
                        <form
                          className="manager-image-row"
                          key={`${image.url}:${imageIndex}`}
                          onSubmit={(event) => {
                            event.preventDefault()
                            saveImageTitle(imageManagerSection, imageIndex)
                          }}
                        >
                          <img src={image.url} alt={image.title || `Imagen ${imageIndex + 1}`} loading="lazy" />
                          <label>
                            Título
                            <input
                              value={currentTitle}
                              onChange={(event) => setImageTitleEdits((current) => ({ ...current, [editKey]: event.target.value }))}
                              maxLength={120}
                            />
                          </label>
                          <div className="manager-row-actions">
                            <button type="submit" disabled={isSaving || currentTitle.trim() === image.title}>Guardar título</button>
                            <button className="is-danger" type="button" onClick={() => deleteSectionImage(imageManagerSection, imageIndex)} disabled={isSaving}>Eliminar</button>
                          </div>
                        </form>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      ) : (
        <div className="manager-company">
          <form className="manager-form manager-company-form" onSubmit={saveCompany}>
            <div className="manager-form-heading">
              <div>
                <h3>Información de la empresa</h3>
                <p>Este es el único registro de empresa del sistema.</p>
              </div>
              {companyRecordId !== null && <small>ID {companyRecordId}</small>}
            </div>
            {isCompanyLoading ? (
              <p className="manager-state" aria-live="polite">Cargando datos de empresa...</p>
            ) : companyErrorMessage ? (
              <p className="manager-message manager-message--error" role="alert">{companyErrorMessage}</p>
            ) : (
              <>
                <div className="manager-company-fields">
                  <label>Título<input value={companyForm.title} onChange={(event) => setCompanyForm({ ...companyForm, title: event.target.value })} maxLength={45} required /></label>
                  <label>Descripción<textarea value={companyForm.description} onChange={(event) => setCompanyForm({ ...companyForm, description: event.target.value })} maxLength={100} rows={2} required /></label>
                  <div className="manager-company-logo">
                    <label htmlFor="company-logo-file">Logo de la empresa <span className="manager-hint">Se optimiza y guarda en PNG (máximo 256 px).</span></label>
                    {companyForm.logo && <img className="manager-company-logo-preview" src={companyForm.logo} alt="Logo actual de la empresa" />}
                    <input
                      id="company-logo-file"
                      type="file"
                      accept="image/*"
                      onChange={(event) => setCompanyLogoFile(event.target.files?.[0] ?? null)}
                    />
                    {companyLogoFile && <span className="manager-hint">Nuevo logo: {companyLogoFile.name}</span>}
                  </div>
                  <label>Correo electrónico<input type="email" value={companyForm.email} onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })} maxLength={100} required /></label>
                  <label>Dirección<textarea value={companyForm.address} onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })} maxLength={300} rows={3} required /></label>
                  <label>Teléfono<input type="tel" value={companyForm.phone} onChange={(event) => setCompanyForm({ ...companyForm, phone: event.target.value })} maxLength={20} required /></label>
                </div>
                <button className="manager-primary-button" type="submit" disabled={isSaving || isCompanyLoading}>
                  {isSaving ? 'Guardando...' : 'Guardar datos de empresa'}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </section>
  )
}

export default BlogContentManager
