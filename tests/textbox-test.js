// A text block's width while typing it, and a background behind its words.
//
// The width used to be settable only once the edit was over: Done, then the
// side handles of the selected block. While typing - when you can see whether
// the words wrap where you want - there was nothing to drag. The editor now
// has a grip on each side; dragging one sets the block's width, the words
// re-wrap as you drag, and you are still typing afterwards. Cancel puts the
// width back with the words.
//
// Text could not have a background at all; only a callout or a filled
// rectangle drawn underneath gave one. Text now takes Fill and the fill colour
// as rectangles and callouts do, painted as a box just outside the words so
// switching it on does not move them.
//
// A turned block keeps its words, background, hit area and handles together,
// grows from its top-left corner when a line is typed or its width dragged,
// and shows its angle beside Cancel and Done, where it can be typed.
const { open, seedPhoto } = require('./harness');
const { finish, isTrue, isFalse, near, atLeast } = require('./expect');

const PHOTO = [61, 107, 143];     // #3d6b8f
const FILL = [255, 224, 102];     // #ffe066
const atMostHalf = v => typeof v === 'number' && v <= 0.5;

async function grip(page, id) {
  return page.evaluate(id => {
    const b = document.getElementById(id).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height,
             shown: b.width > 0 && b.height > 0 };
  }, id);
}

async function drag(page, from, dx) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
}

async function editState(page) {
  return page.evaluate(() => {
    const el = document.getElementById('calloutTextInput');
    const b = el.getBoundingClientRect();
    const t = editingBlock;
    const toScreen = canvas.getBoundingClientRect().width / canvas.width;
    return {
      editing: !!t,
      focused: document.activeElement === el,
      x: t && t.x, w: t && t.w, right: t && t.x + t.w, toScreen,
      lines: t && textBlockMetrics(t).lines.length,
      editorWidth: Math.round(b.width),
      wantWidth: t && Math.round(t.w * toScreen),
      editorLeft: Math.round(b.left),
    };
  });
}

// Read with nothing selected, so a selection handle is never what is sampled.
function pixel(page, x, y) {
  return page.evaluate(([x, y]) => {
    const keep = selectedShape;
    selectedShape = null; redraw();
    const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    selectedShape = keep; redraw();
    return [d[0], d[1], d[2]];
  }, [x, y]);
}

(async () => {
  const r = {};
  const { browser, page, errors } = await open({ viewport: { width: 1280, height: 800 } });
  await seedPhoto(page, { width: 1200, height: 750, colour: '#3d6b8f' });
  const box = await page.locator('#canvas').boundingBox();

  // ---- Width while typing ----
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.keyboard.type('A sentence long enough to wrap onto several lines in a narrow box');
  r.start = await editState(page);
  const east = await grip(page, 'blockGripE');
  const west = await grip(page, 'blockGripW');
  r.grips = { east: east.shown, west: west.shown, tall: Math.min(east.h, west.h) };

  await drag(page, east, 150);
  r.wider = await editState(page);
  await page.keyboard.type(' more');
  r.stillTyping = await page.evaluate(() => editingBlock && editingBlock.text.endsWith(' more'));

  await drag(page, await grip(page, 'blockGripW'), -60);
  r.leftward = await editState(page);

  // Narrower than the minimum stops at the minimum, not at nothing.
  await drag(page, await grip(page, 'blockGripE'), -2000);
  r.narrowest = await editState(page);
  r.narrowest.min = await page.evaluate(() => calloutMinWidth());

  await page.keyboard.press('Control+Enter');
  r.committed = await page.evaluate(() => ({ editing: !!editingBlock, count: shapes.filter(s => s.type === 'text').length }));

  // Cancel puts the width back as well as the words.
  r.cancel = await page.evaluate(() => {
    const t = shapes.find(s => s.type === 'text');
    startBlockEditing(t);
    return { w: t.w, x: t.x };
  });
  await drag(page, await grip(page, 'blockGripE'), 120);
  await page.keyboard.press('Escape');
  r.cancel.after = await page.evaluate(() => { const t = shapes.find(s => s.type === 'text'); return { w: t.w, x: t.x }; });
  r.cancel.restored = Math.abs(r.cancel.after.w - r.cancel.w) < 0.5 && Math.abs(r.cancel.after.x - r.cancel.x) < 0.5;
  r.gripsGone = !(await grip(page, 'blockGripE')).shown;

  // ---- Background ----
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; fillDefault = false;
    document.getElementById('fillToggle').checked = false; redraw(); });
  // Text is still the tool from above; pressing it again would put it down.
  await page.evaluate(() => { document.querySelector('[data-tool="select"]').click();
    document.querySelector('[data-tool="text"]').click(); });
  r.fillOfferedForTool = await page.evaluate(() => !document.getElementById('fillGroup').classList.contains('hidden'));

  const hi = await page.evaluate(() => {
    const t = { type: 'text', x: 300, y: 300, w: 400, h: 0, text: 'Hi', color: '#e53935', size: 3,
                fontSize: 24, rotation: 0, id: 4242 };
    shapes.push(t); selectedShape = t; redraw(); updateButtonStates();
    return { x: t.x, y: t.y, w: t.w, h: t.h };
  });
  // Inside the block, right of the short word: picture with no fill.
  const spot = [hi.x + hi.w - 4, hi.y + hi.h / 2];
  r.plain = { canFill: await page.evaluate(() => canFill(selectedShape)), pixel: await pixel(page, ...spot) };

  await page.evaluate(() => {
    document.getElementById('fillColor').value = '#ffe066';
    document.getElementById('fillColor').dispatchEvent(new Event('input'));
  });
  r.filled = await page.evaluate(() => ({ fill: selectedShape.fill, fillColor: selectedShape.fillColor,
                                           x: selectedShape.x, y: selectedShape.y }));
  r.filled.pixel = await pixel(page, ...spot);
  // The box reaches a little past the words, so they do not sit on its edge,
  // and the words themselves have not moved.
  r.filled.margin = await pixel(page, hi.x - 2, hi.y + hi.h / 2);
  r.filled.wordsStayed = r.filled.x === hi.x && r.filled.y === hi.y;

  // The editor shows the background while typing over it.
  r.editorBg = await page.evaluate(() => {
    startBlockEditing(selectedShape);
    const bg = getComputedStyle(document.getElementById('calloutTextInput')).backgroundColor;
    finishBlockEditing(false);
    return bg;
  });

  // Fill off again from the switch.
  await page.evaluate(() => { const f = document.getElementById('fillToggle'); f.checked = false;
    f.dispatchEvent(new Event('change')); });
  r.unfilled = await pixel(page, ...spot);

  // ---- Turned text ----
  // The words, the background, the hit area and the handles must all be in
  // the same place once a block is turned. They were not: the words turned
  // about their left edge, the handles not at all.
  await page.evaluate(() => {
    shapes.length = 0;
    const t = { type: 'text', x: 300, y: 200, w: 300, h: 0, text: 'Turned text block', color: '#e53935',
                size: 3, fontSize: 24, rotation: Math.PI / 2, fill: true, fillColor: '#ffe066', id: 777 };
    shapes.push(t); selectedShape = t; redraw(); updateButtonStates();
  });
  const turned = await page.evaluate(() => {
    const t = shapes[0]; const f = blockFrame(t);
    const margin = textBackgroundMargin();
    const handleE = getResizeHandles(t).find(h => h.type === 'block-e');
    const rotC = getRotationHandle(t);
    return {
      // In the background's top margin, near the far end, turned and not.
      turnedPoint: f.toWorld(t.w * 0.9, -margin / 2),
      levelPoint: { x: t.x + t.w * 0.9, y: t.y - margin / 2 },
      // Just inside the far side handle, towards the middle.
      nearHandle: { x: handleE.x + (f.cx - handleE.x) * 0.05, y: handleE.y + (f.cy - handleE.y) * 0.05 },
      hitTurned: isPointInShape(f.toWorld(t.w * 0.9, f.h / 2).x, f.toWorld(t.w * 0.9, f.h / 2).y, t),
      hitLevel: isPointInShape(t.x + t.w * 0.9, t.y + f.h / 2, t),
      centreAgrees: Math.abs(rotC.centerX - f.cx) < 0.01 && Math.abs(rotC.centerY - f.cy) < 0.01,
      centre: { x: f.cx, y: f.cy },
    };
  });
  r.turned = {
    turnedPoint: await pixel(page, turned.turnedPoint.x, turned.turnedPoint.y),
    levelPoint: await pixel(page, turned.levelPoint.x, turned.levelPoint.y),
    nearHandle: await pixel(page, turned.nearHandle.x, turned.nearHandle.y),
    centre: await pixel(page, turned.centre.x, turned.centre.y),
    hitTurned: turned.hitTurned,
    hitLevel: turned.hitLevel,
    centreAgrees: turned.centreAgrees,
  };

  // Typing a line into a turned block grows it from its top-left corner; it
  // does not swing about its new centre and slide across the picture.
  const corner = () => page.evaluate(() => { const t = shapes[0]; return blockFrame(t).toWorld(0, 0); });
  await page.evaluate(() => startBlockEditing(shapes[0]));
  const c0 = await corner();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and a second line');
  const c1 = await corner();
  r.turnedTyping = { moved: Math.hypot(c1.x - c0.x, c1.y - c0.y),
                     grew: await page.evaluate(() => textBlockMetrics(shapes[0]).lines.length) };

  // The east grip of a block turned a quarter is dragged down the screen, the
  // way the block points.
  const w0 = await page.evaluate(() => shapes[0].w);
  const ge = await grip(page, 'blockGripE');
  await page.mouse.move(ge.x, ge.y);
  await page.mouse.down();
  await page.mouse.move(ge.x, ge.y + 40, { steps: 4 });
  await page.mouse.move(ge.x, ge.y + 80, { steps: 4 });
  await page.mouse.up();
  const c2 = await corner();
  r.turnedGrip = await page.evaluate(w0 => {
    const toScreen = canvas.getBoundingClientRect().width / canvas.width;
    return { grewScreen: Math.round((shapes[0].w - w0) * toScreen), editing: !!editingBlock,
             focused: document.activeElement === calloutTextInput };
  }, w0);
  r.turnedGrip.moved = Math.hypot(c2.x - c0.x, c2.y - c0.y);

  // The angle, seen and changed in the bar under the editor.
  r.angle = await page.evaluate(() => {
    const field = document.getElementById('blockAngleField').getBoundingClientRect();
    return { shown: field.width > 0, value: document.getElementById('blockAngle').value };
  });
  await page.click('#blockAngle');
  r.angle.stillEditingOnFocus = await page.evaluate(() => !!editingBlock);
  await page.fill('#blockAngle', '45');
  r.angle.after = await page.evaluate(() => ({
    rotation: +shapes[0].rotation.toFixed(4),
    editing: !!editingBlock,
    editorTurned: /rotate/.test(calloutTextInput.style.transform),
  }));
  await page.keyboard.press('Enter');
  r.angle.backToWords = await page.evaluate(() => !!editingBlock && document.activeElement === calloutTextInput);
  await page.keyboard.press('Control+Enter');
  r.angle.kept = await page.evaluate(() => +shapes[0].rotation.toFixed(4));

  // A callout does not turn, so it has no angle to show.
  r.calloutAngle = await page.evaluate(() => {
    const c = { type: 'callout', x: 100, y: 500, w: 200, h: 0, tipX: 50, tipY: 650, text: 'Note',
                color: '#e53935', size: 3, fontSize: 20, fill: true, fillColor: '#fff', id: 888 };
    shapes.push(c); startBlockEditing(c);
    const shown = document.getElementById('blockAngleField').getBoundingClientRect().width > 0;
    finishBlockEditing(false);
    return shown;
  });

  r.errors = errors;
  finish(r, {
    'start.editing': isTrue,
    'grips.east': isTrue,
    'grips.west': isTrue,
    'grips.tall': atLeast(28),

    'wider.editing': isTrue,
    'wider.focused': isTrue,
    'wider.w': w => Math.abs((w - r.start.w) * r.start.toScreen - 150) <= 3,
    'wider.lines': n => n < r.start.lines,
    'wider.editorWidth': w => Math.abs(w - r.wider.wantWidth) <= 1,
    'stillTyping': isTrue,

    'leftward.focused': isTrue,
    'leftward.right': near(r.wider.right, 0.5),
    'leftward.x': x => Math.abs((r.wider.x - x) * r.start.toScreen - 60) <= 3,
    'leftward.editorLeft': x => Math.abs(x - (r.wider.editorLeft - 60)) <= 3,

    'narrowest.w': w => Math.abs(w - r.narrowest.min) < 0.5,

    'committed.editing': isFalse,
    'committed.count': 1,
    'cancel.restored': isTrue,
    'gripsGone': isTrue,

    'fillOfferedForTool': isTrue,
    'plain.canFill': isTrue,
    'plain.pixel': PHOTO,
    'filled.fill': isTrue,
    'filled.fillColor': '#ffe066',
    'filled.pixel': FILL,
    'filled.margin': FILL,
    'filled.wordsStayed': isTrue,
    'editorBg': 'rgb(255, 224, 102)',
    'unfilled': PHOTO,

    'turned.turnedPoint': FILL,
    'turned.levelPoint': PHOTO,
    'turned.nearHandle': p => JSON.stringify(p) !== JSON.stringify(PHOTO),
    'turned.centre': p => JSON.stringify(p) !== JSON.stringify(PHOTO),
    'turned.hitTurned': isTrue,
    'turned.hitLevel': isFalse,
    'turned.centreAgrees': isTrue,
    'turnedTyping.moved': atMostHalf,
    'turnedTyping.grew': atLeast(2),
    'turnedGrip.grewScreen': near(80, 3),
    'turnedGrip.editing': isTrue,
    'turnedGrip.focused': isTrue,
    'turnedGrip.moved': atMostHalf,

    'angle.shown': isTrue,
    'angle.value': '90',
    'angle.stillEditingOnFocus': isTrue,
    'angle.after.rotation': +(Math.PI / 4).toFixed(4),
    'angle.after.editing': isTrue,
    'angle.after.editorTurned': isTrue,
    'angle.backToWords': isTrue,
    'angle.kept': +(Math.PI / 4).toFixed(4),
    'calloutAngle': isFalse,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
