// Tiny, allow-list-based HTML sanitizer for engine-formatted strings only.
//
// SECURITY MODEL: Raw LLM output and player input must NEVER be passed through
// `sanitizeHtml`. They must be rendered with `textContent` (see `setLogText`).
// This helper exists solely so the engine can emit a small, fixed set of
// formatting elements (bold, italic, drop-cap span) without opening an XSS hole.

const ALLOWED_TAGS = new Set(['B', 'I', 'STRONG', 'EM', 'SPAN']);

// Attributes we permit, keyed by tag. Only the `class` attribute on SPAN is
// allowed, and only for the known `drop-cap` value.
const ALLOWED_ATTRS = {
    SPAN: { class: new Set(['drop-cap']) }
};

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitizes an engine-generated HTML string. Anything outside the allow-list is
 * escaped to text. Returns a string safe to assign to `innerHTML`.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    // Parse in a detached document so we can walk the node tree safely.
    const tpl = document.createElement('template');
    tpl.innerHTML = html;

    function walk(node) {
        const children = Array.from(node.childNodes);
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) continue;
            if (child.nodeType !== Node.ELEMENT_NODE) {
                node.removeChild(child);
                continue;
            }
            if (!ALLOWED_TAGS.has(child.tagName)) {
                // Replace disallowed element with its escaped text content.
                const text = document.createTextNode(child.textContent || '');
                node.replaceChild(text, child);
                continue;
            }
            // Strip disallowed attributes.
            for (const attr of Array.from(child.attributes)) {
                const allowed = ALLOWED_ATTRS[child.tagName] && ALLOWED_ATTRS[child.tagName][attr.name];
                const allowedValues = ALLOWED_ATTRS[child.tagName] && ALLOWED_ATTRS[child.tagName][attr.name];
                if (!allowed || (allowedValues && !allowedValues.has(attr.value))) {
                    child.removeAttribute(attr.name);
                }
            }
            walk(child);
        }
    }

    walk(tpl.content);
    return tpl.innerHTML;
}

/**
 * Renders text into an element safely. If `html` is provided and trusted
 * (engine-formatted), it is sanitized; otherwise the raw text is escaped.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {boolean} [isEngineHtml=false] - true only for engine-formatted markup.
 */
export function setLogText(el, text, isEngineHtml = false) {
    if (isEngineHtml) {
        el.innerHTML = sanitizeHtml(text);
    } else {
        el.textContent = text;
    }
}
