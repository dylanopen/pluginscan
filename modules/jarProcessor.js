/**
 * modules/jarProcessor.js
 * Unzips a JAR and extracts the call graph from every .class file.
 *
 * Returns: Map<string, ClassInfo>
 *   ClassInfo { className: string, methods: MethodInfo[] }
 */

import { parseClass } from './decompiler/bytecodeDisassembler.js';

/**
 * @param {File}     file
 * @param {function} onProgress - (percent: number, label: string) => void
 * @returns {Promise<Map<string, ClassInfo>>}
 */
export async function processJar(file, onProgress = () => {}) {
  onProgress(5, 'Reading file…');
  const arrayBuffer = await file.arrayBuffer();

  onProgress(15, 'Unzipping…');
  const zip = await JSZip.loadAsync(arrayBuffer);

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
      // Store a stub so the class still appears in the tree
      classMap.set(className, {
        className,
        parseError: err.message,
        methods: [],
      });
    }

    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  onProgress(100, `Done — ${classMap.size} classes loaded.`);
  return classMap;
}
