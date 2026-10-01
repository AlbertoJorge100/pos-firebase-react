import { mergeAttributes, Node } from '@tiptap/core'
import { getSafeIframeHeight, getTrustedIframeUrl } from './iframeUrl.js'

const TrustedIframe = Node.create({
  name: 'trustedIframe',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => getTrustedIframeUrl(element.getAttribute('src') || ''),
        renderHTML: (attributes) => ({ src: attributes.src }),
      },
      height: {
        default: '360',
        parseHTML: (element) => getSafeIframeHeight(element.getAttribute('height')) || '360',
        renderHTML: (attributes) => ({ height: getSafeIframeHeight(attributes.height) || '360' }),
      },
    }
  },

  parseHTML() {
    return [{
      tag: 'iframe[src]',
      getAttrs: (element) => (
        getTrustedIframeUrl(element.getAttribute('src') || '') ? {} : false
      ),
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes, {
      src: getTrustedIframeUrl(HTMLAttributes.src || '') || 'about:blank',
      title: 'Contenido incrustado',
      width: '100%',
      height: getSafeIframeHeight(HTMLAttributes.height) || '360',
      loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
      allowfullscreen: 'true',
    })]
  },

  addCommands() {
    return {
      insertTrustedIframe: (attributes) => ({ commands }) => {
        const src = getTrustedIframeUrl(attributes.src)
        if (!src) return false

        return commands.insertContent({
          type: this.name,
          attrs: { src },
        })
      },
    }
  },
})

export default TrustedIframe
