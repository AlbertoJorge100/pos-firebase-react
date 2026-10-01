const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

function isAllowedIframeUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false

  if (youtubeHosts.has(url.hostname)) {
    return /^\/embed\/(?:[A-Za-z0-9_-]+|videoseries)$/.test(url.pathname)
  }

  if (url.hostname === 'player.vimeo.com') {
    return /^\/video\/\d+$/.test(url.pathname)
  }

  if (url.hostname === 'www.google.com') {
    return url.pathname === '/maps/embed'
  }

  if (url.hostname === 'maps.google.com') {
    return url.pathname === '/maps' && url.searchParams.get('output') === 'embed'
  }

  return false
}

export function getTrustedIframeUrl(value) {
  try {
    const markdownLink = value.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    const url = new URL(markdownLink ? markdownLink[2] : value)
    return isAllowedIframeUrl(url) ? url.href : null
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

export function getSafeIframeHeight(value) {
  if (!/^\d{1,4}$/.test(value || '')) return null
  const height = Number(value)
  return height > 0 && height <= 4096 ? String(height) : null
}
