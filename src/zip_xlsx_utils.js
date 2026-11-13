const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// CRC32 Lookup Table for ZIP creation
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates a valid ZIP archive buffer from an array of { name: string, data: Buffer | string }
 */
function createZipBuffer(entries) {
  const localFileHeaders = [];
  const centralDirectoryHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData);

    // Local file header (30 bytes + file name)
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // Signature
    lfh.writeUInt16LE(20, 4);         // Version needed (2.0)
    lfh.writeUInt16LE(0x0800, 6);     // General purpose bit flag (UTF-8 filename)
    lfh.writeUInt16LE(8, 8);          // Compression method: Deflate (8)
    lfh.writeUInt16LE(0x4000, 10);    // File last mod time
    lfh.writeUInt16LE(0x5ac8, 12);    // File last mod date
    lfh.writeUInt32LE(crc, 14);       // CRC-32
    lfh.writeUInt32LE(compressed.length, 18); // Compressed size
    lfh.writeUInt32LE(rawData.length, 22);    // Uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);    // File name length
    lfh.writeUInt16LE(0, 28);                 // Extra field length
    nameBuf.copy(lfh, 30);

    localFileHeaders.push(lfh, compressed);

    // Central directory file header (46 bytes + file name)
    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0); // Signature
    cdh.writeUInt16LE(20, 4);         // Version made by
    cdh.writeUInt16LE(20, 6);         // Version needed
    cdh.writeUInt16LE(0x0800, 8);     // UTF-8 flag
    cdh.writeUInt16LE(8, 10);         // Compression method: Deflate
    cdh.writeUInt16LE(0x4000, 12);    // Mod time
    cdh.writeUInt16LE(0x5ac8, 14);    // Mod date
    cdh.writeUInt32LE(crc, 16);       // CRC-32
    cdh.writeUInt32LE(compressed.length, 20); // Compressed size
    cdh.writeUInt32LE(rawData.length, 24);    // Uncompressed size
    cdh.writeUInt16LE(nameBuf.length, 28);    // File name length
    cdh.writeUInt16LE(0, 30);                 // Extra field length
    cdh.writeUInt16LE(0, 32);                 // File comment length
    cdh.writeUInt16LE(0, 34);                 // Disk number start
    cdh.writeUInt16LE(0, 36);                 // Internal file attributes
    cdh.writeUInt32LE(0, 38);                 // External file attributes
    cdh.writeUInt32LE(offset, 42);            // Relative offset of local header
    nameBuf.copy(cdh, 46);

    centralDirectoryHeaders.push(cdh);
    offset += lfh.length + compressed.length;
  }

  const cdBuffer = Buffer.concat(centralDirectoryHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central dir signature
  eocd.writeUInt16LE(0, 4);          // Number of this disk
  eocd.writeUInt16LE(0, 6);          // Disk where CD starts
  eocd.writeUInt16LE(entries.length, 8);  // Number of CD records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of CD records
  eocd.writeUInt32LE(cdBuffer.length, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16);          // Offset of start of CD
  eocd.writeUInt16LE(0, 20);               // Comment length

  return Buffer.concat([...localFileHeaders, cdBuffer, eocd]);
}

/**
 * Extracts entries from a ZIP buffer
 */
function readZipBuffer(buf) {
  const entries = {};
  // Find End of Central Directory (EOCD)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP / XLSX file (EOCD not found)');
  }
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(cdOffset + 10);
    const compressedSize = buf.readUInt32LE(cdOffset + 20);
    const fileNameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const fileName = buf.subarray(cdOffset + 46, cdOffset + 46 + fileNameLen).toString('utf8');

    const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

    let dataBuf;
    if (compressionMethod === 0) {
      dataBuf = compressedData;
    } else if (compressionMethod === 8) {
      dataBuf = zlib.inflateRawSync(compressedData);
    } else {
      dataBuf = Buffer.alloc(0);
    }
    entries[fileName] = dataBuf;
    cdOffset += 46 + fileNameLen + extraLen + commentLen;
  }
  return entries;
}

function escapeXml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colIndexToLetter(idx) {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Generates a valid multi-sheet .xlsx buffer
 * sheets: Array<{ name: string, rows: Array<Array<string|number|null>>, isHeaderRow?: number[] }>
 */
function createXlsxBuffer(sheets) {
  const zipEntries = [];

  zipEntries.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n  ')}
</Types>`
  });

  zipEntries.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  });

  zipEntries.push({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((s, i) => {
      const safeName = escapeXml(s.name.replace(/[:\\/?*\[\]]/g, ' ').substring(0, 31));
      return `<sheet name="${safeName}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    }).join('\n    ')}
  </sheets>
</workbook>`
  });

  zipEntries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n  ')}
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  });

  // Styles: 0=Normal, 1=Title Bold Blue, 2=Table Header Dark Navy White Text, 3=Data Row Bordered
  zipEntries.push({
    name: 'xl/styles.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
</styleSheet>`
  });

  sheets.forEach((sheet, idx) => {
    const rowsXml = sheet.rows.map((row, rIdx) => {
      const rowNum = rIdx + 1;
      const isTitle = rIdx === 0 || rIdx === 1;
      const isHeader = rIdx === 3;
      const styleId = isHeader ? 2 : (isTitle ? 1 : (rIdx > 3 ? 3 : 0));
      const cellsXml = row.map((cellVal, cIdx) => {
        const ref = `${colIndexToLetter(cIdx)}${rowNum}`;
        if (cellVal === null || cellVal === undefined || cellVal === '') {
          return `<c r="${ref}" s="${styleId}"/>`;
        }
        if (typeof cellVal === 'number' && !Number.isNaN(cellVal)) {
          return `<c r="${ref}" s="${styleId}"><v>${cellVal}</v></c>`;
        }
        return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${escapeXml(cellVal)}</t></is></c>`;
      }).join('');
      const ht = isHeader ? ' ht="28" customHeight="1"' : '';
      return `<row r="${rowNum}"${ht}>${cellsXml}</row>`;
    }).join('\n    ');

    zipEntries.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="3" width="16" customWidth="1"/>
    <col min="4" max="5" width="38" customWidth="1"/>
    <col min="6" max="6" width="28" customWidth="1"/>
    <col min="7" max="20" width="16" customWidth="1"/>
    <col min="21" max="24" width="35" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
</worksheet>`
    });
  });

  return createZipBuffer(zipEntries);
}

/**
 * Parses an uploaded .xlsx buffer into sheets and rows for Excel Import (Section 11)
 */
function parseUploadedXlsxBuffer(buf) {
  const entries = readZipBuffer(buf);
  const sharedStrings = [];
  if (entries['xl/sharedStrings.xml']) {
    const ssXml = entries['xl/sharedStrings.xml'].toString('utf8');
    const siMatches = ssXml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g) || [];
      const combined = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
      sharedStrings.push(
        combined
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      );
    }
  }

  const wbXml = entries['xl/workbook.xml'] ? entries['xl/workbook.xml'].toString('utf8') : '';
  const relsXml = entries['xl/_rels/workbook.xml.rels'] ? entries['xl/_rels/workbook.xml.rels'].toString('utf8') : '';
  const relMap = {};
  const relMatches = relsXml.match(/<Relationship\s+[^>]*\/?>/g) || [];
  for (const rm of relMatches) {
    const idM = rm.match(/Id="([^"]+)"/);
    const targetM = rm.match(/Target="([^"]+)"/);
    if (idM && targetM) {
      relMap[idM[1]] = targetM[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
  }

  const parsedSheets = [];
  const sheetMatches = wbXml.match(/<sheet\s+[^>]*\/?>/g) || [];
  for (const sm of sheetMatches) {
    const nameM = sm.match(/name="([^"]+)"/);
    const rIdM = sm.match(/r:id="([^"]+)"/);
    if (!nameM || !rIdM) continue;
    const sheetName = nameM[1];
    const target = 'xl/' + (relMap[rIdM[1]] || `worksheets/sheet1.xml`);
    if (!entries[target]) continue;

    const shXml = entries[target].toString('utf8');
    const rowMatches = shXml.match(/<row\s+[^>]*>[\s\S]*?<\/row>/g) || [];
    const rows = [];
    for (const rm of rowMatches) {
      const rNumM = rm.match(/r="(\d+)"/);
      const rowNum = rNumM ? parseInt(rNumM[1], 10) : 0;
      const cells = {};
      const cellMatches = rm.match(/<c\s+[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      for (const cm of cellMatches) {
        const refM = cm.match(/r="([A-Z]+)\d+"/);
        if (!refM) continue;
        const col = refM[1];
        const typeM = cm.match(/t="([^"]+)"/);
        const cellType = typeM ? typeM[1] : '';
        let val = '';
        if (cellType === 'inlineStr') {
          const tM = cm.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/);
          val = tM ? tM[1] : '';
        } else {
          const vM = cm.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = vM ? vM[1] : '';
          if (cellType === 's') {
            val = sharedStrings[parseInt(rawV, 10)] || '';
          } else {
            val = rawV;
          }
        }
        val = String(val)
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .trim();
        if (val !== '') {
          cells[col] = val;
        }
      }
      rows.push({ excelRow: rowNum, cells });
    }
    parsedSheets.push({ sheetName, rows });
  }
  return parsedSheets;
}

module.exports = {
  createZipBuffer,
  readZipBuffer,
  createXlsxBuffer,
  parseUploadedXlsxBuffer
};

