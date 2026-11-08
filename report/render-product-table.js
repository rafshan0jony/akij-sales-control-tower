'use strict';

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

try { GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf', 'Arial'); } catch (e) {}
try { GlobalFonts.registerFromPath('C:/Windows/Fonts/arialbd.ttf', 'Arial Bold'); } catch (e) {}

const PAD = 16;
const HEAD_H = 32;
const ROW_H = 28;
const TITLE_H = 30;
const HEAD_LINE_H = 16;
const HEAD_PAD = 8;

/** Split `text` into lines that each fit within `maxWidth` px. */
function wrapText(ctx, text, maxWidth) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Render a single JPG table.
 * opts: { title, subtitle, columns: [{h, w, align}], rows: [{...}, ..., {__total:true}] }
 * column keys match the header text `h`.
 */
function renderProductTable(opts) {
  const { title, subtitle, columns, rows } = opts;
  const tableW = columns.reduce((a, c) => a + c.w, 0);

  // Measure + wrap header text so columns never overlap (headers can wrap).
  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = 'bold 13px Arial';
  const headerLines = columns.map((c) => wrapText(measure, c.h, c.w - HEAD_PAD * 2));
  const maxLines = Math.max(1, ...headerLines.map((l) => l.length));
  const headerH = Math.max(HEAD_H, maxLines * HEAD_LINE_H + HEAD_PAD * 2);

  const totalW = Math.max(tableW + PAD * 2, 700);
  const totalH = PAD + TITLE_H + (subtitle ? 22 : 0) + headerH + rows.length * ROW_H + PAD;

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

  // header row (wrapped, vertically centered)
  ctx.fillStyle = '#0b57d0';
  ctx.fillRect(x0, y, tableW, headerH);
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  let hx = x0;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const lines = headerLines[i];
    const tx = c.align === 'right' ? hx + c.w - HEAD_PAD : hx + HEAD_PAD;
    ctx.textAlign = c.align === 'right' ? 'right' : 'left';
    const blockTop = y + (headerH - lines.length * HEAD_LINE_H) / 2;
    for (let li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], tx, blockTop + li * HEAD_LINE_H + HEAD_LINE_H / 2 + 1);
    }
    hx += c.w;
  }
  y += headerH;

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
