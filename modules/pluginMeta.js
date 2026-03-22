/**
 * modules/pluginMeta.js
 * ─────────────────────────────────────────────────────────────────
 * Reads plugin.yml or paper-plugin.yml from a JSZip instance and
 * extracts the plugin name and version.
 *
 * Returns: { name: string, version: string } or null if not found.
 */

/**
 * @param {JSZip} zip
 * @returns {Promise<{name:string, version:string}|null>}
 */
export async function extractPluginMeta(zip) {
  const candidates = ['plugin.yml', 'paper-plugin.yml'];

  for (const filename of candidates) {
    const entry = zip.file(filename);
    if (!entry) continue;

    try {
      const text = await entry.async('string');
      const name    = parseYamlField(text, 'name');
      const version = parseYamlField(text, 'version');
      if (name && version) return { name, version, source: filename };
    } catch (e) {
      console.warn(`[pluginMeta] failed to parse ${filename}:`, e);
    }
  }

  return null;
}

/**
 * Very lightweight YAML scalar field extractor.
 * Handles:  key: value  and  key: 'value'  and  key: "value"
 */
function parseYamlField(text, key) {
  const re = new RegExp(`^${key}\\s*:\\s*['"]?([^'"\\n\\r]+?)['"]?\\s*$`, 'mi');
  const m  = text.match(re);
  return m ? m[1].trim() : null;
}
