'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function walk(directory, excluded = new Set(), includeHidden = false) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.name === '.DS_Store' || entry.name.startsWith('._') || excluded.has(file)) continue;
        if (!includeHidden && entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) throw new Error(`Collegamento simbolico non supportato: ${file}`);
        if (entry.isDirectory()) files.push(...walk(file, excluded, includeHidden));
        else if (entry.isFile()) files.push(file);
    }
    return files.sort();
}

function readJson(file, fingerprints) {
    try {
        const bytes = fs.readFileSync(file);
        const data = JSON.parse(bytes.toString('utf8'));
        fingerprints?.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
        return data;
    }
    catch (error) { throw new Error(`JSON non leggibile: ${file}: ${error.message}`); }
}

function normalize(value) {
    return value.replaceAll('\\', '/').normalize('NFC').toLowerCase();
}

function strings(value, result = new Set(), depth = 0) {
    if (depth > 100) throw new Error('Dipendenze troppo annidate: analisi interrotta.');
    if (typeof value === 'string') {
        // Scenes and presets may themselves contain serialized JSON.
        const trimmed = value.trim();
        if (/^[{["]/.test(trimmed)) {
            let decoded;
            try { decoded = JSON.parse(trimmed); }
            catch {
                // Names such as [AMP] Model.nam are ordinary strings, not JSON.
                if (/^\{\s*["}]|^\[\s*(?:["{\[\]]|true\b|false\b|null\b|-?\d)/.test(trimmed)) {
                    throw new Error('JSON annidato non riconosciuto: analisi interrotta.');
                }
                result.add(normalize(value));
                return result;
            }
            strings(decoded, result, depth + 1);
        } else result.add(normalize(value));
    } else if (value && typeof value === 'object') {
        for (const child of Object.values(value)) strings(child, result, depth + 1);
    }
    return result;
}

const normalizedRefs = new WeakMap();
function matches(refs, file, base) {
    let cached = normalizedRefs.get(refs);
    if (!cached || cached.size !== refs.size) {
        const values = new Set();
        for (const raw of refs) {
            // A literal %20 and an encoded space are both possible filenames.
            values.add(path.posix.normalize(normalize(raw)));
            try { values.add(path.posix.normalize(normalize(decodeURIComponent(raw)))); }
            catch { /* Literal percent in filenames. */ }
        }
        cached = { size: refs.size, values };
        normalizedRefs.set(refs, cached);
    }
    const relative = normalize(path.relative(base, file));
    const basename = path.posix.basename(relative);
    const extension = path.posix.extname(relative);
    const stem = basename.slice(0, -extension.length);
    const marker = normalize(path.basename(base)) + '/';
    for (const ref of cached.values) {
        const full = '/' + ref;
        let index = full.indexOf('/' + marker);
        const qualified = index >= 0;
        while (index >= 0) {
            const target = full.slice(index + marker.length + 1);
            if (target === relative || target === relative.slice(0, -extension.length)) return true;
            index = full.indexOf('/' + marker, index + 1);
        }
        if (!qualified && (ref === relative || ref === relative.slice(0, -extension.length) ||
            path.posix.basename(ref) === basename || path.posix.basename(ref) === stem)) {
            return true; // Ambiguous names retain all matches.
        }
    }
    return false;
}

function content(data, file) {
    let value = data.content;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { throw new Error(`content non è JSON valido: ${file}`); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`content non riconosciuto: ${file}`);
    }
    const { content: ignored, ...metadata } = data;
    return strings(metadata, strings(value));
}

function analyze(directory, { fingerprintCategory = 'all' } = {}) {
    let root;
    try { root = fs.realpathSync(directory); }
    catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ENODEV', 'ENXIO', 'EIO'].includes(error.code)) {
            throw new Error(`Cartella HeadRush non raggiungibile: ${path.resolve(directory)}. Verifica che la HeadRush sia collegata via USB e che il volume sia montato; controlla anche il percorso --data.`, { cause: error });
        }
        throw error;
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    function folder(name, optional = false) {
        const matches = entries.filter(e => e.name.toLowerCase() === name.toLowerCase());
        if (optional && matches.length === 0) return null;
        if (matches.length !== 1 || !matches[0].isDirectory()) throw new Error(`Cartella mancante o ambigua: ${name}`);
        return path.join(root, matches[0].name);
    }
    const folders = { rigs: folder('Rigs'), irs: folder('Impulse Responses'), amps: folder('Amp Clones'), nams: folder('Neural Amp Modeler', true) };
    const protectedDirs = new Set();
    for (const [dir, names] of [[folders.irs, ['headrush', 'choptones']], [folders.amps, ['headrush']]]) {
        for (const entry of fs.readdirSync(dir)) {
            if (names.includes(entry.toLowerCase())) protectedDirs.add(path.join(dir, entry));
        }
    }
    const select = (dir, ext, includeHidden = false) => dir ? walk(dir, protectedDirs, includeHidden).filter(f => path.extname(f).toLowerCase() === ext) : [];
    const rigFiles = select(folders.rigs, '.rig', true);
    const irs = select(folders.irs, '.wav');
    const amps = select(folders.amps, '.ac');
    const nams = select(folders.nams, '.nam');
    const sourceFingerprints = new Map();
    const refs = new Set();
    // All saved blocks remain on the device, so all their dependencies are roots.
    const blocks = entries.filter(e => e.name.toLowerCase() === 'blocks');
    if (blocks.length > 1) throw new Error('Cartella Blocks ambigua');
    if (blocks.length) {
        if (!blocks[0].isDirectory()) throw new Error('Blocks non è una cartella ordinaria');
        for (const file of walk(path.join(root, blocks[0].name), new Set(), true)) {
            const data = readJson(file, sourceFingerprints);
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Preset non riconosciuto: ${file}`);
            const values = Object.hasOwn(data, 'content') ? content(data, file) : strings(data);
            for (const ref of values) refs.add(ref);
        }
    }
    // Every rig remains on the device and protects its resources.
    for (const file of rigFiles) {
        for (const ref of content(readJson(file, sourceFingerprints), file)) refs.add(ref);
    }
    const candidates = [...irs.filter(f => !matches(refs, f, folders.irs)), ...amps.filter(f => !matches(refs, f, folders.amps)), ...nams.filter(f => !matches(refs, f, folders.nams))];
    // Fingerprints detect changes between analysis and deletion.
    const fingerprintFiles = candidates.filter(file => fingerprintCategory === 'all' ||
        (folders[fingerprintCategory] && inside(folders[fingerprintCategory], file)));
    const fingerprints = new Map(fingerprintFiles.map(file => [file, digest(file)]));
    return { root, folders, protectedDirs, candidates, fingerprints, sourceFingerprints,
        counts: { rigs: rigFiles.length, irs: irs.length, amps: amps.length, nams: nams.length } };
}

function digest(file) {
    if (!fs.lstatSync(file).isFile()) throw new Error(`File non ordinario: ${file}`);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        if (!fs.fstatSync(fd).isFile()) throw new Error(`File non ordinario: ${file}`);
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let length;
        while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            hash.update(buffer.subarray(0, length));
        }
        return hash.digest('hex');
    } finally { fs.closeSync(fd); }
}

function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function cleanEmpty(directory, protectedDirs, keepRoot = true) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.name.startsWith('.') || protectedDirs.has(file) || !entry.isDirectory()) continue;
        cleanEmpty(file, protectedDirs, false);
    }
    if (!keepRoot && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

const categories = [['irs', 'Impulse Responses'], ['amps', 'Amp Clones'], ['nams', 'Neural Amp Modeler (.nam)']];

function categoryFiles(plan, category) {
    if (!plan.folders[category]) return [];
    return plan.candidates.filter(file => inside(plan.folders[category], file));
}

function execute(plan, category) {
    if (!categories.some(([key]) => key === category)) throw new Error('Tipologia non valida');
    const files = categoryFiles(plan, category);
    if (!files.length) return 0;
    const fresh = analyze(plan.root, { fingerprintCategory: null });
    if (JSON.stringify(categoryFiles(fresh, category)) !== JSON.stringify(files)) {
        throw new Error('Dipendenze cambiate: ripetere l’analisi.');
    }
    for (const file of files) {
        if (digest(file) !== plan.fingerprints.get(file)) throw new Error(`File modificato: ${file}`);
    }
    // Validate the exact source bytes read during the fresh dependency scan.
    for (const [file, expected] of fresh.sourceFingerprints) {
        if (digest(file) !== expected) throw new Error(`Dipendenze cambiate durante l’analisi: ${file}`);
    }
    let deleted = 0;
    try {
        for (const file of files) {
            if (fs.realpathSync(file) !== file || digest(file) !== plan.fingerprints.get(file)) {
                throw new Error(`File modificato o percorso cambiato: ${file}`);
            }
            fs.unlinkSync(file);
            deleted++;
        }
        cleanEmpty(plan.folders[category], plan.protectedDirs);
    } catch (error) {
        throw new Error(`Operazione interrotta: cancellati ${deleted} di ${files.length} file; nessun ripristino disponibile. ${error.message}`, { cause: error });
    }
    return files.length;
}

async function main(args = process.argv.slice(2), { input = process.stdin, output = process.stdout } = {}) {
    let directory = path.join(__dirname, 'HeadRush');
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help') {
            output.write('node cleaner.js [--data CARTELLA]\nMostra il piano e chiede conferma per ogni tipologia. Cancellazione definitiva, senza backup.\n');
            return;
        }
        if (arg !== '--data' || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Argomento non valido: ${arg}`);
        directory = args[++i];
    }
    const initial = analyze(directory, { fingerprintCategory: null });
    output.write(`Directory: ${initial.root}\nPiano di cancellazione:\n`);
    for (const [key, label] of categories) {
        const files = categoryFiles(initial, key);
        output.write(`${label}: ${files.length} file\n`);
        for (const file of files) output.write(`- ${path.relative(initial.root, file)}\n`);
    }
    if (!initial.candidates.length) return;
    output.write('Attenzione: cancellazione definitiva, senza backup.\n');
    const readline = require('node:readline');
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    const answers = rl[Symbol.asyncIterator]();
    try {
        for (const [key, label] of categories) {
            const plan = analyze(directory, { fingerprintCategory: key });
            const files = categoryFiles(plan, key);
            if (!files.length) {
                output.write(`${label}: 0 file da cancellare.\n`);
                continue;
            }
            output.write(`Piano aggiornato — ${label}: ${files.length} file\n`);
            for (const file of files) output.write(`- ${path.relative(plan.root, file)}\n`);
            let confirmed = false;
            while (true) {
                output.write(`${label}: vuoi cancellare definitivamente ${files.length} file? [s/N] `);
                const answer = await answers.next();
                if (answer.done) {
                    output.write('\nInput terminato: operazione interrotta.\n');
                    return;
                }
                const value = answer.value.trim().toLowerCase();
                if (['s', 'si', 'sì'].includes(value)) { confirmed = true; break; }
                if (['', 'n', 'no'].includes(value)) break;
                output.write('Rispondi s oppure n.\n');
            }
            if (confirmed) output.write(`${label}: cancellati ${execute(plan, key)} file.\n`);
            else output.write(`${label}: cancellazione saltata.\n`);
        }
    } finally { rl.close(); }
}

if (require.main === module) {
    main().catch(error => { console.error(`Errore: ${error.message}`); process.exitCode = 1; });
}
module.exports = { analyze, execute, main };
