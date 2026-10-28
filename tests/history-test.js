const { open, seedPhoto, realErrors } = require('./harness');
const { finish, isTrue } = require('./expect');

// Opening a picture used to throw the last one away. Each one opened now puts
// the one it replaces, drawing and all, on a short list that the menu steps
// through - round, so stepping on long enough comes back to where it started.
(async () => {
  const { browser, page, errors } = await open({ device: 'iPhone 13', settle: 400 });

  const r = {};
  const state = () => page.evaluate(() => {
    const d = ctx.getImageData(5, 5, 1, 1).data;
    return {
      size: img ? [img.naturalWidth, img.naturalHeight] : null,
      pixel: `rgb(${d[0]},${d[1]},${d[2]})`,
      shapes: shapes.map(s => s.type),
      name: sourceFileName,
      undo: undoStack.length,
    };
  });
  const menu = () => page.evaluate(() => {
    openContextMenu(10, 10, null);
    const labels = [...document.querySelectorAll('#contextMenu button')].map(b => b.textContent);
    closeContextMenu();
    return labels;
  });
  const step = async label => {
    await page.evaluate(l => {
      openContextMenu(10, 10, null);
      [...document.querySelectorAll('#contextMenu button')].find(b => b.textContent === l).click();
    }, label);
    await page.waitForTimeout(700);
  };

  r.menuEmpty = await menu();

  await seedPhoto(page, { width: 400, height: 300, colour: '#ff0000', name: 'red.png' });
  await page.evaluate(() => recordUndo(() => shapes.push({ type: 'rect', x: 50, y: 50, w: 100, h: 80,
    rotation: 0, color: '#000000', size: 3, fill: false, id: newShapeId() })));
  await seedPhoto(page, { width: 500, height: 300, colour: '#0000ff', name: 'blue.png' });
  // Each picture gets a drawing of its own.
  await page.evaluate(() => { shapes = [{ type: 'ellipse', x: 60, y: 60, w: 90, h: 70,
    rotation: 0, color: '#000000', size: 3, fill: false, id: newShapeId() }]; redraw(); });
  await seedPhoto(page, { width: 600, height: 300, colour: '#00ff00', name: 'green.png' });

  r.menuFull = await menu();
  r.green = await state();
  await step('Previous image');
  r.prev1 = await state();
  await step('Previous image');
  r.prev2 = await state();
  await step('Previous image');
  r.prev3 = await state(); // round to green
  await step('Next image');
  r.next1 = await state(); // back to red

  // Where it has got to survives a reload, and so does the list.
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForTimeout(1200);
  r.reloaded = await state();
  await step('Next image');
  r.afterReload = await state();

  // The list stops growing at its limit, keeping the newest.
  for (let i = 0; i < 14; i++) {
    await seedPhoto(page, { width: 100 + i, height: 100, name: `n${i}.png`, settle: 250 });
  }
  r.history = await page.evaluate(async () => {
    const h = await dbGet('history');
    return { length: h.length, newest: h[0].doc.fileName, limit: HISTORY_LIMIT };
  });

  r.errors = realErrors(errors);
  finish(r, {
    'menuEmpty': ['Paste image', 'Open image…'],
    'menuFull': ['Paste image', 'Open image…', 'Previous image', 'Next image'],
    'green.size': [600, 300],
    'prev1.size': [500, 300],
    'prev1.pixel': 'rgb(0,0,255)',
    'prev1.shapes': ['ellipse'],
    'prev1.name': 'blue.png',
    // Undo belongs to the picture it was done on.
    'prev1.undo': 0,
    'prev2.size': [400, 300],
    'prev2.pixel': 'rgb(255,0,0)',
    'prev2.shapes': ['rect'],
    'prev3.size': [600, 300],
    'prev3.pixel': 'rgb(0,255,0)',
    'prev3.shapes': [],
    'next1.size': [400, 300],
    'next1.shapes': ['rect'],
    'reloaded.size': [400, 300],
    'reloaded.name': 'red.png',
    'afterReload.size': [500, 300],
    'history.length': 10,
    'history.limit': 10,
    'history.newest': 'n12.png',
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
