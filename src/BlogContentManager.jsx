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
  viewId: '',
  title: '',
  text: '',
  buttonTitle: '',
  images: '',
  isActive: true,
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
    .select('id,title,description,button_title,footer,is_active')
    .eq('company_id', id)
    .order('id', { ascending: true })

  if (viewsResult.error) throw viewsResult.error

  const viewIds = (viewsResult.data ?? []).map((view) => view.id)
  if (viewIds.length === 0) {
    return { views: [], sections: [] }
  }

  const sectionsResult = await supabase
    .from('blog_sections')
    .select('id,title,text,button_title,images,view_id,is_active')
    .in('view_id', viewIds)
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
  const [companyRecordId, setCompanyRecordId] = useState(null)
  const [isCompanyLoading, setIsCompanyLoading] = useState(true)
  const [companyErrorMessage, setCompanyErrorMessage] = useState('')
  const [editingViewId, setEditingViewId] = useState(null)
  const [editingSectionId, setEditingSectionId] = useState(null)
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
        setSelectedViewId(loadedViews[0] ? String(loadedViews[0].id) : '')
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
        loadedViews.some((view) => String(view.id) === currentId)
          ? currentId
          : String(loadedViews[0]?.id ?? '')
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
      setCompanyErrorMessage('')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'No se pudieron actualizar los datos.')
    }
  }

  async function saveCompany(event) {
    event.preventDefault()
    if (companyRecordId === null) return

    const payload = {
      title: companyForm.title.trim(),
      description: companyForm.description.trim(),
      logo: companyForm.logo.trim(),
      email: companyForm.email.trim(),
      address: companyForm.address.trim(),
      phone: companyForm.phone.trim(),
    }

    if (await runMutation(
      'Datos de empresa actualizados.',
      () => supabase.from('blog_companies').update(payload).eq('id', requireCompanyId()),
    )) {
      setCompanyForm(payload)
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
    const payload = {
      title: viewForm.title.trim(),
      description: viewForm.description.trim(),
      button_title: viewForm.buttonTitle.trim(),
      footer: viewForm.footer.trim() || null,
      is_active: viewForm.isActive,
    }
    const operation = () => editingViewId
      ? supabase.from('blog_views').update(payload).eq('id', editingViewId).eq('company_id', requireCompanyId())
      : supabase.from('blog_views').insert({ ...payload, company_id: requireCompanyId() })

    if (await runMutation(editingViewId ? 'Vista actualizada.' : 'Vista creada.', operation)) {
      setViewForm({ ...emptyViewForm })
      setEditingViewId(null)
    }
  }

  async function saveSection(event) {
    event.preventDefault()
    const payload = {
      view_id: sectionForm.viewId,
      title: sectionForm.title.trim(),
      text: sanitizeSectionHtml(sectionForm.text),
      button_title: sectionForm.buttonTitle.trim(),
      images: sectionForm.images.split(/\r?\n/).map((image) => image.trim()).filter(Boolean),
      is_active: sectionForm.isActive,
    }
    const operation = () => editingSectionId
      ? supabase.from('blog_sections').update(payload).eq('id', editingSectionId).eq('company_id', requireCompanyId())
      : supabase.from('blog_sections').insert({...payload, company_id: requireCompanyId()})

    if (await runMutation(editingSectionId ? 'Sección actualizada.' : 'Sección creada.', operation)) {
      setSectionForm({ ...emptySectionForm, viewId: selectedViewId })
      setEditingSectionId(null)
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
    await runMutation('Sección eliminada.', () => supabase.from('blog_sections').delete().eq('id', section.id))
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
    setEditingSectionId(section.id)
    setSectionForm({
      viewId: String(section.view_id),
      title: section.title ?? '',
      text: section.text ?? '',
      buttonTitle: section.button_title ?? '',
      images: Array.isArray(section.images) ? section.images.join('\n') : '',
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
    setSectionForm({ ...emptySectionForm, viewId: selectedViewId })
    setEditingSectionId(null)
    setErrorMessage('')
    setSuccessMessage('')
  }

  const visibleSections = sections.filter((section) => String(section.view_id) === selectedViewId)
  const viewNames = new Map(views.map((view) => [String(view.id), view.title]))

  if (isLoading) return <section className="manager-state" aria-live="polite">Cargando tablas...</section>

  return (
    <section className="content-manager" aria-labelledby="manager-title">
      <header className="manager-heading">
        <div>
          <p className="manager-kicker">ADMINISTRACIÓN</p>
          <div className="manager-title-row">
            <h2 id="manager-title">Contenido del sitio</h2>
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
            {views.map((view) => (
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
            <label>Vista<select value={sectionForm.viewId} onChange={(event) => setSectionForm({ ...sectionForm, viewId: event.target.value })} required>
              <option value="">Selecciona una vista</option>
              {views.map((view) => <option key={view.id} value={view.id}>{view.title}</option>)}
            </select></label>
            <label>Título<input value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} maxLength={100}  /></label>
            <div className="manager-rich-field">
              <span id="section-text-label">Texto / contenido</span>
              <Suspense fallback={<div className="rich-text-editor rich-text-editor--loading" aria-busy="true">Cargando editor...</div>}>
                <RichTextEditor value={sectionForm.text} onChange={(text) => setSectionForm({ ...sectionForm, text })} />
              </Suspense>
            </div>
            <label>Texto del navbar<input value={sectionForm.buttonTitle} onChange={(event) => setSectionForm({ ...sectionForm, buttonTitle: event.target.value })} maxLength={45} required /></label>
            <label>Imágenes <span className="manager-hint">Una URL por línea</span><textarea value={sectionForm.images} onChange={(event) => setSectionForm({ ...sectionForm, images: event.target.value })} rows={3} /></label>
            <label className="manager-checkbox"><input type="checkbox" checked={sectionForm.isActive} onChange={(event) => setSectionForm({ ...sectionForm, isActive: event.target.checked })} /> Sección activa</label>
            <button className="manager-primary-button" type="submit" disabled={isSaving || views.length === 0}>{isSaving ? 'Guardando...' : editingSectionId ? 'Guardar cambios' : 'Crear sección'}</button>
          </form>

          <div className="manager-list">
            <div className="manager-list-heading manager-section-filter">
              <h3>Secciones registradas</h3>
              <select aria-label="Filtrar secciones por vista" value={selectedViewId} onChange={(event) => setSelectedViewId(event.target.value)}>
                {views.map((view) => <option key={view.id} value={view.id}>{view.title}</option>)}
              </select>
            </div>
            {visibleSections.length === 0 && <p className="manager-empty">Esta vista todavía no tiene secciones.</p>}
            {visibleSections.map((section) => (
              <article
                className={`manager-row${String(editingSectionId) === String(section.id) ? ' is-editing' : ''}`}
                key={section.id}
                aria-current={String(editingSectionId) === String(section.id) ? 'true' : undefined}
              >
                <div className="manager-row-copy">
                  <div className="manager-row-title"><h4>{section.title}</h4><span className={section.is_active ? 'manager-status' : 'manager-status is-inactive'}>{section.is_active ? 'Activa' : 'Inactiva'}</span></div>
                  <p>{section.button_title} · {Array.isArray(section.images) ? section.images.length : 0} imágenes</p>
                  <small>ID {section.id} · {viewNames.get(String(section.view_id)) ?? `Vista ${section.view_id}`}</small>
                </div>
                <div className="manager-row-actions">
                  <button type="button" onClick={() => editSection(section)} disabled={isSaving}>Editar</button>
                  <button type="button" onClick={() => toggleSectionStatus(section)} disabled={isSaving}>{section.is_active ? 'Desactivar' : 'Activar'}</button>
                  <button className="is-danger" type="button" onClick={() => deleteSection(section)} disabled={isSaving}>Eliminar</button>
                </div>
              </article>
            ))}
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
                  <label>Logo (URL o ruta)<input value={companyForm.logo} onChange={(event) => setCompanyForm({ ...companyForm, logo: event.target.value })} maxLength={100} required /></label>
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
