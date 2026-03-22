/**
 * modules/jarProcessor.js
 * Unzips a JAR and extracts the call graph from every .class file.
 * Also extracts plugin.yml / paper-plugin.yml metadata.
 *
 * Returns: { classMap: Map<string, ClassInfo>, meta: PluginMeta|null }
 *   ClassInfo { className, superName, interfaceNames, accessFlags,
 *               fields, methods }
 */

import { parseClass }        from './decompiler/bytecodeDisassembler.js';
import { extractPluginMeta } from './pluginMeta.js';

/**
 * Process a File object (user upload).
 * @param {File}     file
 * @param {function} onProgress
 */
export async function processJar(file, onProgress = () => {}) {
  const arrayBuffer = await file.arrayBuffer();
  return processJarBuffer(arrayBuffer, onProgress);
}

/**
 * Process a raw ArrayBuffer (e.g. a reference JAR provided by the user).
 * @param {ArrayBuffer} arrayBuffer
 * @param {function}    onProgress
 */
export async function processJarBuffer(arrayBuffer, onProgress = () => {}) {
  onProgress(5, 'Reading file…');

  onProgress(15, 'Unzipping…');
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Extract plugin metadata from YAML
  const meta = await extractPluginMeta(zip);

  const classEntries = Object.entries(zip.files).filter(
    ([name, entry]) => name.endsWith('.class') && !entry.dir
  );

  if (classEntries.length === 0) throw new Error('No .class files found in this JAR.');

  const classMap = new Map();
  const total    = classEntries.length;

  for (let i = 0; i < total; i++) {
    const [zipPath, entry] = classEntries[i];

    onProgress(
      20 + Math.round((i / total) * 75),
      `Parsing ${i + 1}/${total}: ${zipPath.split('/').pop()}`
    );

    const className = zipPath.replace(/\.class$/, '').replaceAll('/', '.');

    try {
      const bytes     = await entry.async('uint8array');
      const classInfo = parseClass(bytes);
      classMap.set(className, classInfo);
    } catch (err) {
      classMap.set(className, {
        className,
        parseError: err.message,
        methods: [],
        fields:  [],
      });
    }

    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  onProgress(100, `Done — ${classMap.size} classes loaded.`);
  return { classMap, meta };
}
