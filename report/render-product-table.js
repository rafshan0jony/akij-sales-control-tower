'use strict';

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

try { GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf', 'Arial'); } catch (e) {}
try { GlobalFonts.registerFromPath('C:/Windows/Fonts/arialbd.ttf', 'Arial Bold'); } catch (e) {}

const PAD = 16;
const HEAD_H = 32;
const ROW_H = 28;
const TITLE_H = 30;

/**
 * Render a single JPG table.
 * opts: { title, subtitle, columns: [{h, w, align}], rows: [{...}, ..., {__total:true}] }
 * column keys match the header text `h`.
 */
function renderProductTable(opts) {
  const { title, subtitle, columns, rows } = opts;
  const tableW = columns.reduce((a, c) => a + c.w, 0);
  const totalW = Math.max(tableW + PAD * 2, 700);
  const totalH = PAD + TITLE_H + (subtitle ? 22 : 0) + HEAD_H + rows.length * ROW_H + PAD;

  const canvas = createCanvas(totalW, totalH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  let y = PAD;
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, PAD, y + 24);
  y += TITLE_H;

  if (subtitle) {
    ctx.font = '12px Arial';
    ctx.fillStyle = '#777777';
    ctx.fillText(subtitle, PAD, y + 15);
    y += 22;
  }

  const x0 = PAD;

  // header row
  ctx.fillStyle = '#0b57d0';
  ctx.fillRect(x0, y, tableW, HEAD_H);
  ctx.font = 'bold 13px Arial';
  ctx.textBaseline = 'middle';
  let hx = x0;
  for (const c of columns) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = c.align === 'right' ? 'right' : 'left';
    ctx.fillText(c.h, c.align === 'right' ? hx + c.w - 8 : hx + 8, y + HEAD_H / 2 + 1);
    hx += c.w;
  }
  y += HEAD_H;

  // data rows
  rows.forEach((r, i) => {
    if (r.__total) ctx.fillStyle = '#d9e2f3';
    else if (i % 2 === 1) ctx.fillStyle = '#f5f7fa';
    else ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y, tableW, ROW_H);

    let cx = x0;
    for (const c of columns) {
      const val = r[c.h];
      ctx.font = r.__total ? 'bold 14px Arial' : '14px Arial';
      ctx.fillStyle = '#1a1a1a';
      ctx.textBaseline = 'middle';
      ctx.textAlign = c.align === 'right' ? 'right' : 'left';
      const tx = c.align === 'right' ? cx + c.w - 8 : cx + 8;
      ctx.fillText(String(val === undefined || val === null || val === '' ? '' : val), tx, y + ROW_H / 2 + 1);
      cx += c.w;
    }
    y += ROW_H;
  });

  return canvas.toBuffer('image/jpeg');
}

module.exports = { renderProductTable };
