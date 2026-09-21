// Renders AI summaries with `marked`. <rich-text> ignores page CSS, so the
// styling is injected as inline styles on the generated tags.
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

const TAG_STYLES = {
  h1: 'font-size:32rpx;font-weight:700;margin:20rpx 0 8rpx;',
  h2: 'font-size:30rpx;font-weight:700;margin:20rpx 0 8rpx;',
  h3: 'font-size:28rpx;font-weight:700;margin:16rpx 0 6rpx;',
  h4: 'font-size:28rpx;font-weight:700;margin:16rpx 0 6rpx;',
  p: 'margin:8rpx 0;',
  ul: 'margin:8rpx 0;padding-left:40rpx;list-style-type:disc;',
  ol: 'margin:8rpx 0;padding-left:44rpx;',
  li: 'margin:6rpx 0;',
  strong: 'font-weight:700;',
  code: 'background:#f3f3f3;padding:0 6rpx;border-radius:4rpx;'
}

export function markdownToHtml(md) {
  if (!md) return ''
  // Escape raw HTML from the model/user notes: marked would pass it through.
  const safe = md.replace(/</g, '&lt;')
  let html = marked.parse(safe)
  for (const [tag, style] of Object.entries(TAG_STYLES)) {
    html = html.replace(new RegExp(`<${tag}(?=[\\s>])`, 'g'), `<${tag} style="${style}"`)
  }
  return html
}

// One-line preview for cards: drop the markers, keep the words.
export function markdownToPlain(md) {
  if (!md) return ''
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}
