/* Karaoke Overlay host (Premiere Pro 23 ExtendScript; no QE, no project save).
   Imports rendered overlay files into the Project panel (one importFiles call). It never touches sequences, Graphics or keyframes. */
if (typeof KGO === 'undefined') {
var KGO = (function () {
    var VERSION = '0.1.0';
    function fail(message) { throw new Error(message); }
    function json(value) {
        // ExtendScript has no JSON object: serialise the small reply objects by hand.
        if (value === null || value === undefined) return 'null';
        if (typeof value === 'number') return isFinite(value) ? String(value) : 'null';
        if (typeof value === 'boolean') return String(value);
        if (value instanceof Array) {
            var items = [], i;
            for (i = 0; i < value.length; i++) items.push(json(value[i]));
            return '[' + items.join(',') + ']';
        }
        if (typeof value === 'object') {
            var parts = [], k;
            for (k in value) if (value.hasOwnProperty(k)) parts.push(json(String(k)) + ':' + json(value[k]));
            return '{' + parts.join(',') + '}';
        }
        return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
    }
    function reply(fn) {
        try { return json({ ok: true, value: fn() }); }
        catch (e) { return json({ ok: false, error: String(e.message || e) }); }
    }
    function samePath(a, b) { return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase(); }
    function findByPath(folder, path) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var item = folder.children[i], found = null;
            if (item.type === 2 /* BIN */) found = findByPath(item, path);
            else if (samePath(item.getMediaPath(), path)) found = item;
            if (found) return found;
        }
        return null;
    }
    function sequence() {
        if (parseInt(app.version, 10) < 23) fail('Cần Premiere Pro 23 trở lên.');
        var s = app.project.activeSequence;
        if (!s) fail('Mở một sequence trước.');
        return s;
    }
    function info() {
        var s = sequence(), settings = s.getSettings();
        return { name: String(s.name), width: settings.videoFrameWidth || s.frameSizeHorizontal,
                 height: settings.videoFrameHeight || s.frameSizeVertical, timebase: String(s.timebase),
                 videoTracks: s.videoTracks.numTracks, version: String(app.version) };
    }
    /* p: {files: [absolute paths]}. One importFiles call for everything not yet in the project. */
    function importFiles(p) {
        if (parseInt(app.version, 10) < 23) fail('Cần Premiere Pro 23 trở lên.');
        if (!p || !p.files || !p.files.length) fail('Không có file overlay nào để nhập.');
        var todo = [], existing = 0, i;
        for (i = 0; i < p.files.length; i++) {
            if (findByPath(app.project.rootItem, p.files[i])) existing++; else todo.push(p.files[i]);
        }
        if (todo.length && !app.project.importFiles(todo, true, app.project.getInsertionBin(), false)) fail('Premiere không nhập được ' + todo.length + ' file overlay.');
        var missing = [];
        for (i = 0; i < todo.length; i++) if (!findByPath(app.project.rootItem, todo[i])) missing.push(todo[i]);
        if (missing.length) fail('Đã nhập nhưng không thấy trong Project: ' + missing.join(', '));
        return { imported: todo.length, alreadyInProject: existing };
    }
    return { version: VERSION,
        info: function () { return reply(info); },
        importFiles: function (text) { return reply(function () { return importFiles(eval('(' + decodeURIComponent(text) + ')')); }); } };
}());
}
