/**
 * modules/spigotApi.js
 * ─────────────────────────────────────────────────────────────────
 * SpigotMC API wrapper.
 *
 * SpigotMC public REST API base: https://api.spiget.org/v2
 * Docs: https://spiget.org/
 *
 * Flow:
 *   1. Search for the resource by name  → GET /search/resources/{name}
 *   2. Pick the best match (exact name, preferring free resources)
 *   3. Fetch its version list            → GET /resources/{id}/versions
 *   4. Find the version matching plugin.yml version string
 *   5. Download the JAR                  → GET /resources/{id}/versions/{vid}/download
 *      (this returns a redirect or the file directly; Spiget proxies the download)
 *
 * NOTE: Spiget only hosts/proxies resources uploaded to SpigotMC.
 * Resources that link to external download pages cannot be downloaded
 * via this API. In that case we surface a helpful error.
 *
 * CORS: Spiget supports CORS from browsers on the API endpoints.
 * The download endpoint may redirect to the SpigotMC CDN which also
 * allows CORS. If the request is blocked we surface a clear error.
 */

const SPIGET = 'https://api.spiget.org/v2';

/**
 * @typedef {{ id:number, name:string, tag:string, external:boolean }} ResourceMeta
 * @typedef {{ id:number, name:string, uuid:string }}                  VersionMeta
 */

/**
 * Search for a SpigotMC resource by plugin name.
 * Returns the best-matching resource or null.
 *
 * @param {string} pluginName
 * @returns {Promise<ResourceMeta|null>}
 */
export async function findResource(pluginName) {
  const url = `${SPIGET}/search/resources/${encodeURIComponent(pluginName)}?field=name&size=10&sort=-downloads`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SpigotMC search failed: HTTP ${res.status}`);

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  // Prefer an exact (case-insensitive) name match; otherwise take the top result
  const exact = results.find(r => r.name?.toLowerCase() === pluginName.toLowerCase());
  return exact ?? results[0];
}

/**
 * Fetch the version list for a resource.
 *
 * @param {number} resourceId
 * @returns {Promise<VersionMeta[]>}
 */
export async function getVersions(resourceId) {
  const url = `${SPIGET}/resources/${resourceId}/versions?size=100&sort=-name`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SpigotMC versions fetch failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Find the version entry whose name matches the plugin.yml version string.
 * Falls back to the latest version if no exact match.
 *
 * @param {VersionMeta[]} versions
 * @param {string}        targetVersion
 * @returns {{ version: VersionMeta, matched: boolean }}
 */
export function matchVersion(versions, targetVersion) {
  if (!versions.length) throw new Error('Resource has no versions listed.');

  const exact = versions.find(v =>
    v.name?.trim().toLowerCase() === targetVersion.trim().toLowerCase()
  );
  if (exact) return { version: exact, matched: true };

  // Partial match: version string appears at start or end
  const partial = versions.find(v =>
    v.name?.toLowerCase().includes(targetVersion.toLowerCase()) ||
    targetVersion.toLowerCase().includes(v.name?.toLowerCase() ?? '')
  );
  if (partial) return { version: partial, matched: false };

  // Fall back to first (most recent) version
  return { version: versions[0], matched: false };
}

export async function downloadUrl(url) {
    const res = await fetch(url);

    if (!res.ok) {
	if (res.status === 404) throw new Error('Version download not available via SpigotMC API');
	throw new Error(`Download failed: HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
	// Got a redirect page rather than bytes — external resource
	throw new Error('Plugin cannot be fetched automatically.');
    }

    return res.arrayBuffer();
}

/**
 * Download the JAR for a specific resource version.
 * Returns an ArrayBuffer of the JAR bytes.
 *
 * @param {number} resourceId
 * @param {number} versionId
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadVersion(resourceId, versionId) {
    const url = `${SPIGET}/resources/${resourceId}/versions/${versionId}/download`;
    return downloadUrl(url);
}

/**
 * High-level: find plugin on SpigotMC, match version, download JAR.
 * Calls onStatus(message) for progress updates.
 *
 * @param {string}   pluginName
 * @param {string}   pluginVersion
 * @param {function} onStatus
 * @returns {Promise<{ buffer: ArrayBuffer, resource: ResourceMeta, version: VersionMeta, versionMatched: boolean }>}
 */
export async function fetchOfficialJar(pluginName, pluginVersion, onStatus = () => {}) {
    onStatus(`Searching SpigotMC for "${pluginName}"…`);
    const resource = await findResource(pluginName);
    if (!resource) throw new Error(`No SpigotMC resource found for "${pluginName}".`);

    onStatus(`Found "${resource.name}" (id ${resource.id}). Fetching versions…`);
    const versions = await getVersions(resource.id);

    const { version, matched } = matchVersion(versions, pluginVersion);
    if (!matched) {
	onStatus(`⚠ Exact version "${pluginVersion}" not found; using "${version.name}" instead.`);
    } else {
	onStatus(`Matched version "${version.name}". Downloading…`);
    }

    if (resource.external) {
	var buffer = await downloadUrl(resource.file.externalUrl);
    } else {
	var buffer = await downloadVersion(resource.id, version.id);
    }

    onStatus(`Downloaded ${(buffer.byteLength / 1024).toFixed(0)} KB.`);

    return { buffer, resource, version, versionMatched: matched };
}
