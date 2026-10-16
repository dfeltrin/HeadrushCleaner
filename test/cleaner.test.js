'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyze, execute, main } = require('../cleaner');

function fixture(t) {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'headrush-test-')));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const root = path.join(temp, 'device');
    for (const dir of ['Rigs', 'Setlists', 'Impulse Responses/HeadRush', 'Amp Clones/HeadRush']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    const put = (name, value) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
        return file;
    };
    put('Setlists/live.setlist', { rigs: ['keep'] });
    put('Rigs/keep.rig', { id: 'keep', content: JSON.stringify({ ir: '/usb/Impulse Responses/A/Cab Deluxe.wav', amp: 'Used' }) });
    put('Rigs/drop.rig', { id: 'drop', content: JSON.stringify({ ir: 'Unused.wav' }) });
    for (const name of ['A/Cab Deluxe.wav', 'B/Cab Deluxe.wav', 'Cab.wav', 'Unused.wav']) put('Impulse Responses/' + name, 'audio');
    put('Amp Clones/Used.ac', 'amp');
    put('Amp Clones/Unused.ac', 'amp');
    return { temp, root, put, backup: path.join(temp, 'backup') };
}
function snapshot(dir) {
    return fs.readdirSync(dir).sort().map(name => {
        const file = path.join(dir, name);
        return [name, fs.statSync(file).isDirectory() ? snapshot(file) : fs.readFileSync(file).toString('base64')];
    });
}

test('declining every category leaves files intact', async t => {
    const f = fixture(t);
    f.put('Impulse Responses/.DS_Store', 'metadata');
    const before = snapshot(f.root);
    await run(f, ['n', 'n', 'n']);
    assert.deepEqual(snapshot(f.root), before);
    const names = analyze(f.root).candidates.map(p => path.relative(f.root, p));
    assert.deepEqual(names, ['Impulse Responses/B/Cab Deluxe.wav', 'Impulse Responses/Cab.wav', 'Amp Clones/Unused.ac']);
});
test('confirming all categories preserves every rig and its resources', async t => {
    const f = fixture(t);
    const files = analyze(f.root).candidates;
    const output = await run(f, ['s', 's', 's']);
    for (const file of files) assert.equal(fs.existsSync(file), false);
    assert.doesNotMatch(output, /Rig:|setlist/i);
    assert.ok(fs.existsSync(path.join(f.root, 'Rigs/drop.rig')));
    assert.ok(fs.existsSync(path.join(f.root, 'Impulse Responses/Unused.wav')));
    assert.match(output, /Impulse Responses: vuoi cancellare definitivamente 2 file/);
    assert.equal(fs.existsSync(f.backup), false);
    assert.equal(analyze(f.root).candidates.length, 0);
});
test('keeping rigs preserves their dependencies and updates counts', async t => {
    const f = fixture(t);
    const output = await run(f, ['s', 'n']);
    assert.ok(fs.existsSync(path.join(f.root, 'Rigs/drop.rig')));
    assert.ok(fs.existsSync(path.join(f.root, 'Impulse Responses/Unused.wav')));
    assert.ok(fs.existsSync(path.join(f.root, 'Amp Clones/Unused.ac')));
    assert.match(output, /Impulse Responses: vuoi cancellare definitivamente 2 file/);
});
test('EOF and empty or invalid answers never authorize deletion', async t => {
    const f = fixture(t);
    const before = snapshot(f.root);
    await run(f, ['maybe', '']);
    assert.deepEqual(snapshot(f.root), before);
});
test('setlists are ignored even when empty, malformed or absent', t => {
    const f = fixture(t);
    const expected = analyze(f.root).candidates;
    for (const value of [{ rigs: [] }, { rigs: ['missing'] }, '{']) {
        f.put('Setlists/live.setlist', value);
        assert.deepEqual(analyze(f.root).candidates, expected);
    }
    fs.rmSync(path.join(f.root, 'Setlists'), { recursive: true });
    assert.deepEqual(analyze(f.root).candidates, expected);
    assert.throws(() => execute(analyze(f.root), 'rigs'), /Tipologia non valida/);
    assert.equal(execute(analyze(f.root), 'irs'), 2);
});
test('malformed JSON and missing directories fail before mutations', t => {
    const f = fixture(t);
    f.put('Rigs/drop.rig', '{');
    assert.throws(() => analyze(f.root), /JSON/);
    assert.equal(fs.existsSync(f.backup), false);
    fs.rmSync(path.join(f.root, 'Rigs'), { recursive: true });
    assert.throws(() => analyze(f.root), /Cartella/);
});
test('blocks and ambiguous bare names preserve resources', t => {
    const f = fixture(t);
    f.put('Blocks/Cab/block.preset', { content: JSON.stringify({ ir: 'Cab Deluxe.wav', other: 'Unused.wav' }) });
    const names = analyze(f.root).candidates.map(p => path.basename(p));
    assert.ok(!names.includes('Cab Deluxe.wav'));
    assert.ok(!names.includes('Unused.wav'));
});
test('changes to dependencies invalidate the deletion plan', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    f.put('Rigs/drop.rig', { content: { ir: 'Cab.wav' } });
    assert.throws(() => execute(plan, 'irs'), /Dipendenze cambiate/);
    for (const file of plan.candidates) assert.ok(fs.existsSync(file));
});
test('changed candidates are rejected', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    fs.appendFileSync(plan.candidates[0], ' ');
    assert.throws(() => execute(plan, 'irs'), /File modificato/);
    for (const file of plan.candidates) assert.ok(fs.existsSync(file));
});
test('nested symlinks and obsolete options are rejected', async t => {
    const f = fixture(t);
    fs.symlinkSync(f.temp, path.join(f.root, 'Rigs/link'));
    assert.throws(() => analyze(f.root), /simbolico/);
    for (const args of [['list'], ['delete'], ['--backup', f.backup]]) await assert.rejects(main(args), /Argomento/);
});
test('invalid inner content aborts analysis', t => {
    const f = fixture(t);
    f.put('Rigs/keep.rig', { id: 'keep', content: 'unrecognized' });
    assert.throws(() => analyze(f.root), /content/);
});

async function run(f, answers) {
    const { Readable, Writable } = require('node:stream');
    let output = '';
    await main(['--data', f.root], {
        input: Readable.from(answers.map(answer => answer + '\n')),
        output: new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } })
    });
    return output;
}

test('all rigs protect resources even when their references form cycles', t => {
    const f = fixture(t);
    f.put('Rigs/keep.rig', { id: 'keep', content: { next: 'DROP' } });
    f.put('Rigs/drop.rig', { id: 'drop', content: { next: 'Rigs/third.rig' } });
    f.put('Rigs/third.rig', { id: 'third', content: { next: 'keep', ir: 'Unused.wav', amp: 'Unused' } });
    const names = analyze(f.root).candidates.map(p => path.relative(f.root, p));
    assert.ok(!names.some(p => p.startsWith('Rigs/')));
    assert.ok(!names.includes('Impulse Responses/Unused.wav'));
    assert.ok(!names.includes('Amp Clones/Unused.ac'));
});
test('scene JSON and references outside content preserve dependencies', t => {
    const f = fixture(t);
    f.put('Rigs/keep.rig', { id: 'keep', extra: 'Unused.ac', content: { scene: JSON.stringify({ nested: JSON.stringify({ ir: 'Unused.wav' }) }) } });
    const names = analyze(f.root).candidates.map(p => path.basename(p));
    assert.ok(!names.includes('Unused.wav'));
    assert.ok(!names.includes('Unused.ac'));
});
test('saved blocks preserve rigs and their indirect resources', t => {
    const f = fixture(t);
    f.put('Blocks/scene.block', { content: { next: 'drop' } });
    const names = analyze(f.root).candidates.map(p => path.basename(p));
    assert.ok(!names.includes('drop.rig'));
    assert.ok(!names.includes('Unused.wav'));
});
test('resource deletion preserves dependencies of every rig', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    assert.equal(execute(plan, 'irs'), 2);
    assert.ok(fs.existsSync(path.join(f.root, 'Impulse Responses/Unused.wav')));
});
test('a new scene reference after confirmation invalidates resource deletion', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    f.put('Blocks/new.block', { content: { ir: 'Cab.wav' } });
    assert.throws(() => execute(plan, 'irs'), /Dipendenze cambiate/);
    for (const file of plan.candidates) assert.ok(fs.existsSync(file));
});
test('encoded paths, backslashes and extensionless relative paths preserve resources', t => {
    const f = fixture(t);
    f.put('Rigs/keep.rig', { id: 'keep', content: { a: 'Impulse%20Responses/A/./Cab%20Deluxe.wav', b: 'B\\Cab Deluxe', c: 'Impulse Responses/Unused.wav' } });
    const names = analyze(f.root).candidates.map(p => path.relative(f.root, p));
    assert.deepEqual(names.filter(p => p.startsWith('Impulse Responses/')), ['Impulse Responses/Cab.wav']);
});

test('NAM candidates exclude direct, indirect, scene and block dependencies', t => {
    const f = fixture(t);
    for (const name of ['Direct.nam', 'Indirect.nam', 'Scene.nam', 'Block.nam', 'A/Duplicate.nam', 'B/Duplicate.NAM', 'Orphan.NAM', 'notes.txt']) {
        f.put('Neural Amp Modeler/User/' + name, 'model');
    }
    f.put('Rigs/keep.rig', { id: 'keep', content: {
        model: '/usb/Neural Amp Modeler/User/Direct.nam', next: 'drop',
        scene: JSON.stringify({ model: 'Scene.nam' }), duplicate: 'Duplicate'
    } });
    f.put('Rigs/drop.rig', { id: 'drop', content: { model: 'Indirect.nam' } });
    f.put('Blocks/NAM/saved.block', { content: { model: 'Block.nam' } });
    const plan = analyze(f.root);
    assert.equal(plan.counts.nams, 7);
    assert.deepEqual(plan.candidates.filter(p => p.includes('Neural Amp Modeler')).map(p => path.basename(p)), ['Orphan.NAM']);
});
test('NAM has its own confirmation and only deletes approved unused models', async t => {
    const f = fixture(t);
    f.put('Neural Amp Modeler/User/Used.nam', 'used');
    const orphan = f.put('Neural Amp Modeler/User/Orphan.nam', 'unused');
    f.put('Neural Amp Modeler/User/notes.txt', 'keep');
    f.put('Rigs/drop.rig', { id: 'drop', content: { model: 'Used.nam' } });
    const before = snapshot(f.root);
    const declined = await run(f, ['n', 'n', 'n', 'n']);
    assert.deepEqual(snapshot(f.root), before);
    assert.match(declined, /Neural Amp Modeler \(\.nam\): vuoi cancellare definitivamente 1 file/);
    await run(f, ['n', 'n', 's']);
    assert.equal(fs.existsSync(orphan), false);
    assert.ok(fs.existsSync(path.join(f.root, 'Neural Amp Modeler/User/Used.nam')));
    assert.ok(fs.existsSync(path.join(f.root, 'Neural Amp Modeler/User/notes.txt')));
});
test('NAM deletion rechecks references and model contents', t => {
    const f = fixture(t);
    const model = f.put('Neural Amp Modeler/User/Orphan.nam', 'unused');
    const plan = analyze(f.root);
    f.put('Blocks/new.block', { content: { model: 'Orphan.nam' } });
    assert.throws(() => execute(plan, 'nams'), /Dipendenze cambiate/);
    fs.unlinkSync(path.join(f.root, 'Blocks/new.block'));
    fs.appendFileSync(model, 'modified');
    assert.throws(() => execute(plan, 'nams'), /File modificato/);
    assert.ok(fs.existsSync(model));
});
test('missing NAM folder is allowed but symlinked NAM folders are rejected', t => {
    const f = fixture(t);
    assert.equal(analyze(f.root).counts.nams, 0);
    fs.symlinkSync(f.temp, path.join(f.root, 'Neural Amp Modeler'));
    assert.throws(() => analyze(f.root), /Cartella mancante o ambigua/);
});

test('literal percent sequences and encoded references both preserve resources', t => {
    const f = fixture(t);
    f.put('Impulse Responses/Cab%20Name.wav', 'literal');
    f.put('Impulse Responses/Cab Name.wav', 'decoded');
    f.put('Rigs/keep.rig', { id: 'keep', content: { ir: 'Impulse Responses/Cab%20Name.wav' } });
    const names = analyze(f.root).candidates.map(p => path.basename(p));
    assert.ok(!names.includes('Cab%20Name.wav'));
    assert.ok(!names.includes('Cab Name.wav'));
});
test('a repeated library folder name in a path does not hide a dependency', t => {
    const f = fixture(t);
    const file = f.put('Impulse Responses/Impulse Responses/Nested.wav', 'audio');
    f.put('Rigs/keep.rig', { id: 'keep', content: { ir: '/usb/Impulse Responses/Impulse Responses/Nested.wav' } });
    assert.ok(!analyze(f.root).candidates.includes(file));
});
test('hidden retained rigs and blocks protect resources', t => {
    const f = fixture(t);
    const rig = f.put('Rigs/.archive/hidden.rig', { id: 'hidden', content: { ir: 'Unused.wav' } });
    f.put('Blocks/.saved/hidden.block', { content: { amp: 'Unused.ac' } });
    const plan = analyze(f.root);
    assert.ok(!plan.candidates.includes(rig));
    assert.ok(!plan.candidates.includes(path.join(f.root, 'Impulse Responses/Unused.wav')));
    assert.ok(!plan.candidates.includes(path.join(f.root, 'Amp Clones/Unused.ac')));
});

test('serialized arrays starting with numbers and quoted JSON strings preserve dependencies', t => {
    const f = fixture(t);
    f.put('Rigs/keep.rig', { id: 'keep', content: {
        scene: JSON.stringify([1, { ir: 'Unused.wav' }]),
        model: JSON.stringify('Unused.ac')
    } });
    const names = analyze(f.root).candidates.map(p => path.basename(p));
    assert.ok(!names.includes('Unused.wav'));
    assert.ok(!names.includes('Unused.ac'));
});
test('dependency changes during the final scan stop deletion', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    const target = path.join(f.root, 'Rigs/keep.rig');
    const read = fs.readFileSync;
    let changed = false;
    t.mock.method(fs, 'readFileSync', function(file, ...args) {
        const bytes = read.call(fs, file, ...args);
        if (file === target && !changed) {
            changed = true;
            f.put('Rigs/keep.rig', { id: 'keep', content: { ir: 'Cab.wav' } });
        }
        return bytes;
    });
    try {
        assert.throws(() => execute(plan, 'irs'), /Dipendenze cambiate durante/);
        for (const file of plan.candidates) assert.ok(fs.existsSync(file));
    } finally { t.mock.restoreAll(); }
});
test('partial deletion errors report the exact completed count and stop', t => {
    const f = fixture(t);
    const plan = analyze(f.root);
    const files = plan.candidates.filter(p => p.includes('Impulse Responses'));
    const unlink = fs.unlinkSync;
    let attempts = 0;
    t.mock.method(fs, 'unlinkSync', function(file) {
        attempts++;
        if (attempts === 2) throw new Error('Simulated disk error');
        return unlink.call(fs, file);
    });
    try {
        assert.throws(() => execute(plan, 'irs'), /cancellati 1 di 2 file.*Simulated disk error/);
        assert.equal(fs.existsSync(files[0]), false);
        assert.equal(fs.existsSync(files[1]), true);
        assert.equal(attempts, 2);
    } finally { t.mock.restoreAll(); }
});
test('protected folders, hidden metadata and unrelated formats survive cleanup', t => {
    const f = fixture(t);
    const protectedFile = f.put('Impulse Responses/HeadRush/factory.wav', 'factory');
    const metadata = f.put('Impulse Responses/Empty/.DS_Store', 'metadata');
    const other = f.put('Impulse Responses/notes.txt', 'notes');
    execute(analyze(f.root), 'irs');
    for (const file of [protectedFile, metadata, other]) assert.ok(fs.existsSync(file));
});
test('launcher works from another directory and EOF does not delete', t => {
    const f = fixture(t);
    const before = snapshot(f.root);
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(path.join(__dirname, '..', 'start.sh'), ['--data', f.root], {
        cwd: f.temp, input: '', encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Input terminato/);
    assert.deepEqual(snapshot(f.root), before);
});

test('large model fingerprints cover all chunks including the final partial chunk', t => {
    const f = fixture(t);
    const file = f.put('Neural Amp Modeler/Large.nam', '');
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 37, 65);
    fs.writeFileSync(file, bytes);
    const plan = analyze(f.root);
    const crypto = require('node:crypto');
    assert.equal(plan.fingerprints.get(file), crypto.createHash('sha256').update(bytes).digest('hex'));
    bytes[bytes.length - 1] = 66;
    fs.writeFileSync(file, bytes);
    assert.throws(() => execute(plan, 'nams'), /File modificato/);
});

test('interactive plan does not hash NAM models before their category is reached', async t => {
    const f = fixture(t);
    const model = f.put('Neural Amp Modeler/Unused.nam', 'model');
    const open = fs.openSync;
    let reads = 0;
    t.mock.method(fs, 'openSync', function(file, ...args) {
        if (file === model) reads++;
        return open.call(fs, file, ...args);
    });
    try {
        await run(f, []);
        assert.equal(reads, 0);
    } finally { t.mock.restoreAll(); }
});

test('missing device and disconnected symlink report a clear USB message before prompting', async t => {
    const f = fixture(t);
    const missing = path.join(f.temp, 'disconnected');
    const link = path.join(f.temp, 'HeadRush');
    fs.symlinkSync(missing, link);
    for (const directory of [missing, link]) {
        assert.throws(() => analyze(directory), /Cartella HeadRush non raggiungibile:.*collegata via USB.*--data/);
        const { spawnSync } = require('node:child_process');
        const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'cleaner.js'), '--data', directory], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Cartella HeadRush non raggiungibile/);
    }
});
