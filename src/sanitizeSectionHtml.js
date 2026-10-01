import { getSafeIframeHeight, getTrustedIframeUrl } from './iframeUrl.js'

const allowedTags = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG',
  'U', 'UL',
])

const discardedTags = new Set([
  'AUDIO', 'BUTTON', 'FORM', 'INPUT', 'LINK', 'META', 'OBJECT', 'SCRIPT',
  'SELECT', 'STYLE', 'SVG', 'TEXTAREA', 'VIDEO',
])

function getSafeWebUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

function copySafeStyle(source, target) {
  const style = source.style
  if (['left', 'center', 'right', 'justify'].includes(style.textAlign)) {
    target.style.textAlign = style.textAlign
  }

  if (style.color && CSS.supports('color', style.color)) target.style.color = style.color
  if (style.backgroundColor && CSS.supports('color', style.backgroundColor)) {
    target.style.backgroundColor = style.backgroundColor
  }
  if (/^(?:\d+(?:\.\d+)?)(?:px|pt|em|rem|%)$/.test(style.fontSize)) {
    target.style.fontSize = style.fontSize
  }
  if (style.fontFamily && !/url\s*\(|[<>;]/i.test(style.fontFamily)) {
    target.style.fontFamily = style.fontFamily
  }
}

function sanitizeNode(node, ownerDocument) {
  if (node.nodeType === Node.TEXT_NODE) {
    return ownerDocument.createTextNode(node.nodeValue || '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const tagName = node.tagName
  if (tagName === 'IFRAME') {
    const src = getTrustedIframeUrl(node.getAttribute('src') || '')
    if (!src) return null

    const iframe = ownerDocument.createElement('iframe')
    iframe.setAttribute('src', src)
    iframe.setAttribute('title', 'Contenido incrustado')
    iframe.setAttribute('width', '100%')
    iframe.setAttribute('height', getSafeIframeHeight(node.getAttribute('height')) || '360')
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation')
    iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture')
    iframe.setAttribute('allowfullscreen', '')
    return iframe
  }
  if (discardedTags.has(tagName)) return null

  const element = ownerDocument.createElement(allowedTags.has(tagName) ? tagName.toLowerCase() : 'span')
  if (tagName === 'A') {
    const href = getSafeWebUrl(node.getAttribute('href') || '')
    if (href) {
      element.setAttribute('href', href)
      element.setAttribute('rel', 'noopener noreferrer')
      if (node.getAttribute('target') === '_blank') element.setAttribute('target', '_blank')
      if (node.getAttribute('title')) element.setAttribute('title', node.getAttribute('title'))
    }
  } else if (tagName === 'IMG') {
    const src = getSafeWebUrl(node.getAttribute('src') || '')
    if (!src) return null
    element.setAttribute('src', src)
    element.setAttribute('alt', node.getAttribute('alt') || '')
    if (node.getAttribute('title')) element.setAttribute('title', node.getAttribute('title'))
  } else if (tagName === 'SPAN' || /^H[1-6]$/.test(tagName) || tagName === 'P') {
    copySafeStyle(node, element)
  }

  if (tagName === 'P') {
    const result = ownerDocument.createDocumentFragment()
    let paragraph = element

    node.childNodes.forEach((child) => {
      const sanitizedChild = sanitizeNode(child, ownerDocument)
      if (!sanitizedChild) return

      if (sanitizedChild.nodeType === Node.ELEMENT_NODE && sanitizedChild.tagName === 'IFRAME') {
        if (paragraph.textContent.trim() || paragraph.children.length) result.append(paragraph)
        result.append(sanitizedChild)
        paragraph = ownerDocument.createElement('p')
        copySafeStyle(node, paragraph)
      } else {
        paragraph.append(sanitizedChild)
      }
    })

    if (paragraph.textContent.trim() || paragraph.children.length) result.append(paragraph)
    return result
  }

  node.childNodes.forEach((child) => {
    const sanitizedChild = sanitizeNode(child, ownerDocument)
    if (sanitizedChild) element.append(sanitizedChild)
  })
  return element
}

export function sanitizeSectionHtml(value) {
  if (typeof value !== 'string' || !value) return ''

  const parsedDocument = new DOMParser().parseFromString(value, 'text/html')
  const sanitizedDocument = document.implementation.createHTMLDocument('')
  parsedDocument.body.childNodes.forEach((node) => {
    const sanitizedNode = sanitizeNode(node, sanitizedDocument)
    if (sanitizedNode) sanitizedDocument.body.append(sanitizedNode)
  })
  return sanitizedDocument.body.innerHTML
}
