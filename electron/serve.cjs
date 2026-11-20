// Pure helpers for the app:// bundle server. Kept free of Electron APIs so the
// path-resolution rules can be unit tested with plain Node.
const path = require('node:path');

/**
 * Map a request pathname (e.g. "/src/game/main.js") to an absolute file path
 * inside `root`. Returns null when the request tries to escape the bundle.
 */
function resolveAppPath(pathname, root) {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, '.' + path.posix.normalize('/' + decoded));
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) return null;
  return target;
}

module.exports = { resolveAppPath };
