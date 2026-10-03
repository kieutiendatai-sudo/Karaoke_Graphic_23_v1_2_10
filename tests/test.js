'use strict';
const assert=require('node:assert/strict');
const C=require('../extension/js/core.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}

test('Timecode uses the sequence frame grid and start offset',()=>{
  assert.equal(C.timecode(32.23,30000/1001,103,0),'00:00:32:06');
  assert.equal(C.timecode(1/25,25,101,3600),'01:00:00:01');
  assert.equal(C.duration(71.35),'01:11.350');
});

test('Drop-frame skips labels only at non-tenth minutes',()=>{
  const fps=30000/1001;
  assert.equal(C.timecode(30*60/fps,fps,102,0),'00:01:00;02');
  assert.equal(C.timecode((30*600-18)/fps,fps,102,0),'00:10:00;00');
});

test('SRT two rows are normalized to one row',()=>{
  const a=C.parseSRT('\ufeff1\r\n00:00:01,000 --> 00:00:04,000\r\n<i>I am</i>\r\nlistening\r\n');
  assert.equal(a[0].text,'I am listening');
});

test('Manual newlines are normalized to one row',()=>{
  const t=C.tokens('one\ntwo   three');
  assert.deepEqual(t.lines,['one two three']);
  assert(t.words.every(w=>w.row===0));
});

test('Timing preserves total duration and word order on frame grid',()=>{
  const t=C.timing('I am listening',3,30);
  assert.equal(t.words[0].startFrame,0);
  assert.equal(t.words.at(-1).endFrame,90);
  assert.equal(t.words.reduce((n,w)=>n+w.durationFrames,0),90);
  assert(t.words.every(w=>w.durationFrames>=1));
});

test('Short words no longer receive a tiny linear-character share',()=>{
  const t=C.timing('My wife sent me a photo captioned,',2.1,30);
  const a=t.words.find(w=>w.word==='a');
  const captioned=t.words.find(w=>w.word.indexOf('captioned')===0);
  assert(a.durationFrames>=3);
  assert(captioned.durationFrames/a.durationFrames<4);
  assert.equal(t.words.at(-1).endFrame,63);
});

test('Frame timing never advances past the cue and gives words a frame when possible',()=>{
  const t=C.timing('a a a a a',0.2,30);
  assert.deepEqual(t.words.map(w=>w.durationFrames),[2,1,1,1,1]);
  assert.deepEqual(t.words.map(w=>w.startFrame),[0,2,3,4,5]);
  assert.equal(t.words.at(-1).endFrame,6);
});

console.log(checks+' core single-line tests passed.');
