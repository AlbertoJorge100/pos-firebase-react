import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import TrustedIframe from './TrustedIframe.js'
import { getTrustedIframeUrl } from './iframeUrl.js'
import './RichTextEditor.css'

const extensions = [
  StarterKit.configure({
    link: { openOnClick: false },
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image.configure({ allowBase64: false }),
  TrustedIframe,
]

function getSafeWebUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function plainTextToHtml(value) {
  return value
    .split(/\r?\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split(/\r?\n/).map(escapeHtml).join('<br>')}</p>`)
    .join('')
}

function RichTextEditor({ value, onChange }) {
  const lastSyncedValue = useRef(value || '')
  const [isSourceMode, setIsSourceMode] = useState(false)
  const [sourceValue, setSourceValue] = useState(value || '')
  const editor = useEditor({
    extensions,
    content: value || '',
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
        'aria-label': 'Contenido de la sección',
      },
      handlePaste: (_view, event) => {
        const plainText = event.clipboardData?.getData('text/plain') || ''
        if (!/<iframe\b/i.test(plainText)) return false

        const iframePattern = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi
        let html = ''
        let previousIndex = 0
        let match = iframePattern.exec(plainText)

        while (match) {
          html += plainTextToHtml(plainText.slice(previousIndex, match.index))
          const srcMatch = match[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)
          const src = srcMatch ? getTrustedIframeUrl(srcMatch[2]) : null
          html += src
            ? `<iframe src="${escapeHtml(src)}"></iframe>`
            : plainTextToHtml(match[0])
          previousIndex = match.index + match[0].length
          match = iframePattern.exec(plainText)
        }

        html += plainTextToHtml(plainText.slice(previousIndex))
        event.preventDefault()
        editor.commands.insertContent(html)
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const html = currentEditor.getHTML()
      lastSyncedValue.current = html
      onChange(html)
    },
  })

  useEffect(() => {
    if (!editor || isSourceMode) return

    const nextValue = value || ''
    if (nextValue === lastSyncedValue.current) return

    lastSyncedValue.current = nextValue
    editor.commands.setContent(nextValue, { emitUpdate: false })
  }, [editor, isSourceMode, value])

  if (!editor) return <div className="rich-text-editor rich-text-editor--loading" aria-busy="true" />

  function runToolbarAction(event, action) {
    event.preventDefault()
    action()
  }

  function toggleSourceMode() {
    if (!editor) return
    const hasExternalChange = (value || '') !== lastSyncedValue.current
    const currentSource = hasExternalChange ? value || '' : sourceValue

    if (!isSourceMode) {
      const html = hasExternalChange ? currentSource : editor.getHTML()
      setSourceValue(html)
      lastSyncedValue.current = html
      setIsSourceMode(true)
      return
    }

    editor.commands.setContent(currentSource, { emitUpdate: false })
    const html = editor.getHTML()
    lastSyncedValue.current = html
    onChange(html)
    setIsSourceMode(false)
  }

  function addLink() {
    const currentUrl = editor.getAttributes('link').href || ''
    const input = window.prompt('URL del enlace (http:// o https://):', currentUrl)
    if (input === null) return

    const url = getSafeWebUrl(input.trim())
    if (!url) {
      window.alert('Introduce una URL que comience con http:// o https://.')
      return
    }

    editor.chain().focus().setLink({ href: url, target: '_blank', rel: 'noopener noreferrer' }).run()
  }

  function addImage() {
    const input = window.prompt('URL de la imagen (http:// o https://):')
    if (input === null) return

    const url = getSafeWebUrl(input.trim())
    if (!url) {
      window.alert('Introduce una URL que comience con http:// o https://.')
      return
    }

    editor.chain().focus().setImage({ src: url, alt: 'Imagen de la sección' }).run()
  }

  function addIframe() {
    const input = window.prompt(
      'Pega la URL de inserción de YouTube, Vimeo o Google Maps (https://...)',
    )
    if (input === null) return

    const src = getTrustedIframeUrl(input.trim())
    if (!src) {
      window.alert('La URL debe ser una URL de inserción válida de YouTube, Vimeo o Google Maps.')
      return
    }

    editor.chain().focus().insertTrustedIframe({ src }).run()
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-editor-toolbar" role="toolbar" aria-label="Formato del contenido">
        <div className="rich-editor-group" role="group" aria-label="Estilos de texto">
          <button type="button" title="Negrita" aria-label="Negrita" aria-pressed={editor.isActive('bold')} className={editor.isActive('bold') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleBold().run())}><strong>B</strong></button>
          <button type="button" title="Cursiva" aria-label="Cursiva" aria-pressed={editor.isActive('italic')} className={editor.isActive('italic') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleItalic().run())}><em>I</em></button>
          <button type="button" title="Subrayado" aria-label="Subrayado" aria-pressed={editor.isActive('underline')} className={editor.isActive('underline') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleUnderline().run())}><u>U</u></button>
          <button type="button" title="Tachado" aria-label="Tachado" aria-pressed={editor.isActive('strike')} className={editor.isActive('strike') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleStrike().run())}><s>S</s></button>
          <button type="button" title="Código en línea" aria-label="Código en línea" aria-pressed={editor.isActive('code')} className={editor.isActive('code') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleCode().run())}>{'{ }'}</button>
        </div>

        <div className="rich-editor-group" role="group" aria-label="Formato de párrafo">
          <select aria-label="Tipo de párrafo" value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph'} onChange={(event) => {
            const level = Number(event.target.value.slice(1))
            if (event.target.value === 'paragraph') editor.chain().focus().setParagraph().run()
            else editor.chain().focus().toggleHeading({ level }).run()
          }}>
            <option value="paragraph">Párrafo</option>
            <option value="h1">Título 1</option>
            <option value="h2">Título 2</option>
            <option value="h3">Título 3</option>
          </select>
          <button type="button" title="Lista con viñetas" aria-label="Lista con viñetas" aria-pressed={editor.isActive('bulletList')} className={editor.isActive('bulletList') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleBulletList().run())}>• Lista</button>
          <button type="button" title="Lista numerada" aria-label="Lista numerada" aria-pressed={editor.isActive('orderedList')} className={editor.isActive('orderedList') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleOrderedList().run())}>1. Lista</button>
          <button type="button" title="Cita" aria-label="Cita" aria-pressed={editor.isActive('blockquote')} className={editor.isActive('blockquote') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleBlockquote().run())}>Cita</button>
          <button type="button" title="Bloque de código" aria-label="Bloque de código" aria-pressed={editor.isActive('codeBlock')} className={editor.isActive('codeBlock') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().toggleCodeBlock().run())}>Código</button>
          <button type="button" title="Línea horizontal" aria-label="Línea horizontal" onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().setHorizontalRule().run())}>Línea</button>
        </div>

        <div className="rich-editor-group" role="group" aria-label="Personalización de texto">
          <select aria-label="Familia tipográfica" defaultValue="" onChange={(event) => {
            const chain = editor.chain().focus()
            if (event.target.value) chain.setFontFamily(event.target.value).run()
            else chain.unsetFontFamily().run()
          }}>
            <option value="">Tipografía</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Times New Roman', serif">Times New Roman</option>
            <option value="'Courier New', monospace">Monoespaciada</option>
          </select>
          <select aria-label="Tamaño de texto" defaultValue="" onChange={(event) => {
            const chain = editor.chain().focus()
            if (event.target.value) chain.setFontSize(event.target.value).run()
            else chain.unsetFontSize().run()
          }}>
            <option value="">Tamaño</option>
            <option value="12px">12 px</option>
            <option value="14px">14 px</option>
            <option value="16px">16 px</option>
            <option value="18px">18 px</option>
            <option value="24px">24 px</option>
            <option value="32px">32 px</option>
            <option value="48px">48 px</option>
          </select>
          <label className="rich-editor-color" title="Color de texto">
            <span aria-hidden="true">A</span>
            <input type="color" aria-label="Color de texto" defaultValue="#24372d" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} />
          </label>
          <label className="rich-editor-color rich-editor-color--highlight" title="Color de resaltado">
            <span aria-hidden="true">▰</span>
            <input type="color" aria-label="Color de resaltado" defaultValue="#fff176" onChange={(event) => editor.chain().focus().toggleHighlight({ color: event.target.value }).run()} />
          </label>
          <button type="button" title="Quitar resaltado" aria-label="Quitar resaltado" onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().unsetHighlight().run())}>Sin resaltado</button>
        </div>

        <div className="rich-editor-group" role="group" aria-label="Alineación y contenido">
          <button type="button" title="Alinear a la izquierda" aria-label="Alinear a la izquierda" aria-pressed={editor.isActive({ textAlign: 'left' })} className={editor.isActive({ textAlign: 'left' }) ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().setTextAlign('left').run())}>Izquierda</button>
          <button type="button" title="Centrar" aria-label="Centrar" aria-pressed={editor.isActive({ textAlign: 'center' })} className={editor.isActive({ textAlign: 'center' }) ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().setTextAlign('center').run())}>Centro</button>
          <button type="button" title="Alinear a la derecha" aria-label="Alinear a la derecha" aria-pressed={editor.isActive({ textAlign: 'right' })} className={editor.isActive({ textAlign: 'right' }) ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().setTextAlign('right').run())}>Derecha</button>
          <button type="button" title="Justificar" aria-label="Justificar" aria-pressed={editor.isActive({ textAlign: 'justify' })} className={editor.isActive({ textAlign: 'justify' }) ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().setTextAlign('justify').run())}>Justificar</button>
          <button type="button" title="Insertar enlace" aria-label="Insertar enlace" aria-pressed={editor.isActive('link')} className={editor.isActive('link') ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, addLink)}>Enlace</button>
          <button type="button" title="Quitar enlace" aria-label="Quitar enlace" disabled={!editor.isActive('link')} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().unsetLink().run())}>Quitar enlace</button>
          <button type="button" title="Insertar imagen" aria-label="Insertar imagen" onMouseDown={(event) => runToolbarAction(event, addImage)}>Imagen</button>
          <button type="button" title="Insertar video o mapa" aria-label="Insertar iframe" onMouseDown={(event) => runToolbarAction(event, addIframe)}>Video / mapa</button>
        </div>

        <div className="rich-editor-group rich-editor-group--history" role="group" aria-label="Historial y limpieza">
          <button type="button" title={isSourceMode ? 'Volver al editor visual' : 'Editar código HTML'} aria-label={isSourceMode ? 'Volver al editor visual' : 'Editar código HTML'} aria-pressed={isSourceMode} className={isSourceMode ? 'is-active' : ''} onMouseDown={(event) => runToolbarAction(event, toggleSourceMode)}>{isSourceMode ? 'Visual' : 'HTML'}</button>
          <button type="button" title="Limpiar formato" aria-label="Limpiar formato" onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().unsetAllMarks().clearNodes().run())}>Limpiar</button>
          <button type="button" title="Deshacer" aria-label="Deshacer" disabled={!editor.can().undo()} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().undo().run())}>↶</button>
          <button type="button" title="Rehacer" aria-label="Rehacer" disabled={!editor.can().redo()} onMouseDown={(event) => runToolbarAction(event, () => editor.chain().focus().redo().run())}>↷</button>
        </div>
      </div>
      {isSourceMode ? (
        <textarea
          className="rich-editor-source"
          aria-label="Código HTML del contenido"
          spellCheck="false"
          value={sourceValue}
          onChange={(event) => {
            const html = event.target.value
            setSourceValue(html)
            lastSyncedValue.current = html
            onChange(html)
          }}
        />
      ) : (
        <EditorContent editor={editor} className="rich-editor-viewport" />
      )}
    </div>
  )
}

export default RichTextEditor
