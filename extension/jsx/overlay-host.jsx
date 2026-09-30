/* Karaoke Overlay host (Premiere Pro 23 ExtendScript; no QE, no project save).
   Imports ONE overlay file and puts ONE clip on the timeline. It never creates Graphics or keyframes. */
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
    function setMotion(clip, position, scale) {
        var motion = null, i;
        for (i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (String(c.matchName).indexOf('Motion') >= 0 || String(c.displayName) === 'Motion') { motion = c; break; }
        }
        if (!motion) fail('Không tìm thấy hiệu ứng Motion trên clip overlay.');
        var done = { position: false, scale: false };
        for (i = 0; i < motion.properties.numItems; i++) {
            var p = motion.properties[i], name = String(p.displayName);
            if (name === 'Position') { p.setValue(position, true); done.position = true; }
            else if (name === 'Scale') { p.setValue(scale, true); done.scale = true; }
        }
        if (!done.position || !done.scale) fail('Không đặt được Position/Scale (giao diện Premiere cần là tiếng Anh).');
    }
    /* p: {file, startSeconds, trackIndex (0-based), position:[x,y] (0..1), scale, insert:boolean} */
    function importOverlay(p) {
        var s = sequence();
        if (!findByPath(app.project.rootItem, p.file)) {
            if (!app.project.importFiles([p.file], true, app.project.getInsertionBin(), false)) fail('Premiere không nhập được file: ' + p.file);
        }
        var item = findByPath(app.project.rootItem, p.file);
        if (!item) fail('Đã nhập nhưng không tìm thấy mục trong Project: ' + p.file);
        var result = { imported: true, inserted: false, projectItem: String(item.name) };
        if (!p.insert) return result;
        if (p.trackIndex < 0 || p.trackIndex >= s.videoTracks.numTracks) fail('Track video V' + (p.trackIndex + 1) + ' không tồn tại.');
        var track = s.videoTracks[p.trackIndex];
        if (typeof track.isLocked === 'function' && track.isLocked()) fail('Track V' + (p.trackIndex + 1) + ' đang khóa.');
        var t = new Time(); t.seconds = p.startSeconds;
        track.overwriteClip(item, t);
        var clip = null, i;
        for (i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (Math.abs(c.start.seconds - p.startSeconds) < 0.05 && String(c.projectItem.nodeId) === String(item.nodeId)) { clip = c; break; }
        }
        if (!clip) fail('Đã chèn nhưng không tìm thấy clip mới trên V' + (p.trackIndex + 1) + '.');
        setMotion(clip, p.position, p.scale);
        result.inserted = true;
        result.start = clip.start.seconds;
        return result;
    }
    return { version: VERSION,
        info: function () { return reply(info); },
        importOverlay: function (text) { return reply(function () { return importOverlay(eval('(' + decodeURIComponent(text) + ')')); }); } };
}());
}
