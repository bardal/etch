// A callout's words sit in the middle of its box, and a box put down with a
// tap fits the words typed into it.
//
// The words sat high: each line took 1.25 times the font size, and all of the
// extra quarter went underneath, so a one-line callout had a thin margin above
// its words and a fat one below. The editor, being CSS, splits that extra
// space above and below - so the words also jumped up a little on Done.
//
// And a tapped callout was a fixed 200px wide whatever went in it, so "Try
// this!" sat at the left of a box with a wide empty space on its right. A box
// put down with a tap now fits its words as they are typed, up to that same
// width, then wraps. A width the user chose - by dragging the box out, or by
// dragging a side while typing or after - is kept.
const { open, seedPhoto } = require('./harness');
const { finish, isTrue, near, atLeast, atMost } = require('./expect');

// The rows of a callout's box that hold its words: anything clearly red that
// is not the box's own outline.
async function inkRows(page, s) {
  return page.evaluate(id => {
    const keep = selectedShape;
    selectedShape = null; redraw();
    const s = shapes.find(t => t.id === id);
    const inset = Math.ceil(strokeWidth(s.size)) + 2;
    const x0 = Math.round(s.x + inset), x1 = Math.round(s.x + s.w - inset);
    const y0 = Math.round(s.y + inset), y1 = Math.round(s.y + s.h - inset);
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let top = -1, bottom = -1;
    for (let row = 0; row < y1 - y0; row++) {
      for (let col = 0; col < x1 - x0; col++) {
        const i = (row * (x1 - x0) + col) * 4;
        if (d[i] > 150 && d[i + 1] < 120 && d[i + 2] < 120) {
          if (top < 0) top = row;
          bottom = row;
          break;
        }
      }
    }
    selectedShape = keep; redraw();
    return { above: y0 + top - s.y, below: s.y + s.h - (y0 + bottom + 1), fontSize: textHeightOf(s) };
  }, s.id);
}

async function tool(page, name) {
  await page.evaluate(name => {
    document.querySelector('[data-tool="select"]').click();
    document.querySelector(`[data-tool="${name}"]`).click();
  }, name);
}

// As wide as the widest line, but never under the narrowest a block can be.
const fits = s => Math.abs(s.w - Math.max(s.min, s.widest + 2 * s.padding)) <= 1;
const shape = page => page.evaluate(() => {
  const s = shapes[shapes.length - 1];
  const m = textBlockMetrics(s);
  ctx.font = buildFont(s);
  const widest = Math.max(...m.lines.map(l => ctx.measureText(l).width));
  return { id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, right: s.x + s.w, lines: m.lines.length,
           widest, padding: m.padding, size: s.size, min: calloutMinWidth() };
});

(async () => {
  const r = {};
  const { browser, page, errors } = await open({ viewport: { width: 1280, height: 800 } });
  await seedPhoto(page, { width: 1200, height: 750, colour: '#3d6b8f' });
  const box = await page.locator('#canvas').boundingBox();
  const at = (x, y) => page.evaluate(([x, y]) => {
    const b = canvas.getBoundingClientRect();
    return { x: b.left + x * b.width / canvas.width, y: b.top + y * b.height / canvas.height };
  }, [x, y]);

  // ---- Words in the middle of the box ----
  const centred = await page.evaluate(() => {
    const s = { type: 'callout', x: 300, y: 200, w: 400, h: 0, tipX: 200, tipY: 400, text: 'Try this!',
                color: '#e53935', size: 4, fontSize: 40, fill: true, fillColor: '#ffffff', rotation: 0, id: 501 };
    shapes.push(s); redraw();
    return { id: s.id };
  });
  r.centred = await inkRows(page, centred);
  r.centred.off = Math.abs(r.centred.above - r.centred.below);

  // ---- A tapped callout fits its words ----
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); });
  await tool(page, 'callout');
  let p = await at(300, 300);
  await page.mouse.click(p.x, p.y);
  r.tapDefault = await page.evaluate(() => ({ w: editingBlock && editingBlock.w, want: Math.min(canvas.width * 0.6, fitPxToCanvas(200)) }));
  await page.keyboard.type('Try this!');
  r.typing = await shape(page);
  // While typing it may be a few pixels wider than the words, room for the
  // editor's caret and border; Done fits it tight.
  r.typing.fits = await page.evaluate(() => canvas.getBoundingClientRect().width / canvas.width)
    .then(k => r.typing.w >= Math.max(r.typing.min, r.typing.widest + 2 * r.typing.padding) - 1
             && r.typing.w <= r.typing.widest + 2 * r.typing.padding + 10 / k);
  r.typing.editorMatches = await page.evaluate(() => {
    const b = calloutTextInput.getBoundingClientRect();
    const toScreen = canvas.getBoundingClientRect().width / canvas.width;
    return Math.abs(b.width - editingBlock.w * toScreen) <= 1;
  });
  await page.keyboard.press('Control+Enter');
  r.done = await shape(page);
  r.done.fits = fits(r.done);

  // Typing more into it again grows it, up to the width a tap gives, then wraps.
  await page.evaluate(() => startBlockEditing(shapes[shapes.length - 1]));
  await page.keyboard.press('End');
  await page.keyboard.type(' A longer note that will need to wrap onto another line');
  await page.keyboard.press('Control+Enter');
  r.long = await shape(page);
  r.long.max = r.tapDefault.want;
  r.long.fits = fits(r.long);

  // ---- A width the user chose is kept ----
  // Dragged out.
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); });
  await tool(page, 'callout');
  const a = await at(200, 450), b = await at(700, 520);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => editingBlock && editingBlock.w);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Control+Enter');
  r.dragged = { before: dragged, after: (await shape(page)).w };

  // Set with a grip while typing.
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); });
  await tool(page, 'callout');
  p = await at(300, 300);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type('Hi');
  const g = await page.evaluate(() => {
    const e = document.getElementById('blockGripE').getBoundingClientRect();
    return { x: e.left + e.width / 2, y: e.top + e.height / 2 };
  });
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + 60, g.y, { steps: 4 });
  await page.mouse.move(g.x + 120, g.y, { steps: 4 });
  await page.mouse.up();
  const gripped = await page.evaluate(() => editingBlock.w);
  await page.keyboard.type(' there');
  await page.keyboard.press('Control+Enter');
  r.gripped = { before: gripped, after: (await shape(page)).w };

  // ---- Text blocks fit too, and keep the side they are aligned to ----
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); });
  await tool(page, 'text');
  p = await at(300, 600);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type('Hello there');
  await page.keyboard.press('Control+Enter');
  r.text = await shape(page);
  r.text.fits = fits(r.text);

  const right = await page.evaluate(() => {
    const s = { type: 'text', x: 600, y: 100, w: 300, h: 0, text: '', color: '#e53935', size: 3,
                fontSize: 24, textAlign: 'right', rotation: 0, fitWidth: 300, id: 777 };
    shapes.push(s); startBlockEditing(s);
    return s.x + s.w;
  });
  await page.keyboard.type('Right aligned');
  await page.keyboard.press('Control+Enter');
  r.right = await shape(page);
  r.right.fits = fits(r.right);
  r.right.keptRight = r.right.right - right;

  // With small words - a small font, or the picture zoomed out - the editor's
  // font is held at 16px and is larger than the words drawn. It must not
  // wrap a line the picture does not.
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; defaultFontSize = 11; redraw(); });
  await tool(page, 'callout');
  p = await at(500, 400);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type('Try this!');
  r.zoomedOut = await page.evaluate(() => {
    const cs = getComputedStyle(calloutTextInput);
    const line = parseFloat(cs.fontSize) * 1.25;
    const inner = calloutTextInput.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return { editorFontBumped: parseFloat(cs.fontSize) > textHeightOf(editingBlock) * canvas.getBoundingClientRect().width / canvas.width + 0.5,
             editorLines: Math.round(Math.max(calloutTextInput.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), inner) / line),
             drawnLines: textBlockMetrics(editingBlock).lines.length };
  });
  await page.keyboard.press('Control+Enter');
  r.zoomedOut.done = await shape(page);
  r.zoomedOut.done.fits = fits(r.zoomedOut.done);

  r.errors = errors;
  finish(r, {
    'centred.off': atMost(r.centred.fontSize * 0.08),
    'tapDefault.w': w => Math.abs(w - r.tapDefault.want) < 0.5,
    'typing.fits': isTrue,
    'typing.editorMatches': isTrue,
    'done.fits': isTrue,
    'done.lines': 1,
    'long.w': w => w <= r.long.max + 0.5,
    'long.fits': isTrue,
    'long.lines': atLeast(2),
    'dragged.after': near(r.dragged.before, 0.5),
    'gripped.after': near(r.gripped.before, 0.5),
    'text.fits': isTrue,
    'right.fits': isTrue,
    'right.keptRight': near(0, 0.5),
    'zoomedOut.editorFontBumped': isTrue,
    'zoomedOut.drawnLines': 1,
    'zoomedOut.editorLines': 1,
    'zoomedOut.done.fits': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
