// Tab Logic
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(link => {
  link.addEventListener('click', () => {
    const tabId = link.getAttribute('data-tab');

    tabLinks.forEach(l => l.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    link.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});

// --- INVOICE EXTRACTOR LOGIC ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const resultsSection = document.getElementById('results-section');
const resultsBody = document.getElementById('results-body');
const scanningLine = document.getElementById('scanning-line');
const downloadBtn = document.getElementById('download-btn');
const clearBtn = document.getElementById('clear-btn');
const geminiKeyInput = document.getElementById('gemini-key');
const deepAnalysisCheckbox = document.getElementById('deep-analysis');

if (localStorage.getItem('gemini_api_key')) {
  geminiKeyInput.value = localStorage.getItem('gemini_api_key');
}
if (localStorage.getItem('deep_analysis') === 'true') {
  deepAnalysisCheckbox.checked = true;
}

let discoveredModel = 'gemini-1.5-flash'; // Fallback

geminiKeyInput.addEventListener('input', (e) => {
  localStorage.setItem('gemini_api_key', e.target.value);
  autoDiscoverModel(e.target.value);
});

async function autoDiscoverModel(apiKey) {
  if (!apiKey) return;
  console.log('🔍 Discovering suitable Gemini model...');
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) return;
    const data = await response.json();
    const models = data.models
      .filter(m => m.supportedGenerationMethods.includes('generateContent'))
      .filter(m => m.name.includes('gemini'));

    if (models.length > 0) {
      // Prioritize flash models
      const flash = models.find(m => m.name.toLowerCase().includes('flash'));
      discoveredModel = flash ? flash.name.replace('models/', '') : models[0].name.replace('models/', '');
      console.log('✅ Auto-discovered model:', discoveredModel);
    }
  } catch (e) {
    console.warn('Discovery failed, using fallback:', discoveredModel);
  }
}

// Initial discovery
if (geminiKeyInput.value) {
  autoDiscoverModel(geminiKeyInput.value);
}

deepAnalysisCheckbox.addEventListener('change', (e) => {
  localStorage.setItem('deep_analysis', e.target.checked);
});

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(99, 102, 241, 0.05)'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.background = 'transparent'; });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.background = 'transparent';
  handleFiles(e.dataTransfer.files);
});

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function handleFiles(files) {
  console.log('Files received:', files.length);
  if (files.length === 0) return;
  scanningLine.style.display = 'block';
  resultsSection.style.display = 'block';
  for (const file of files) {
    console.log('Processing file:', file.name, 'Type:', file.type);
    try {
      await processFile(file);
    } catch (error) {
      console.error('CRITICAL Error processing file:', file.name, error);
      const row = document.createElement('tr');
      row.innerHTML = `<td>${file.name}</td><td colspan="5" style="color: var(--danger);">Error: ${error.message}</td>`;
      resultsBody.prepend(row);
    }
  }
  scanningLine.style.display = 'none';
}

async function processFile(file) {
  const initialRow = document.createElement('tr');
  initialRow.innerHTML = `<td>${file.name}</td><td colspan="5" style="color: var(--text-muted); font-style: italic;">Preparing file...</td>`;
  resultsBody.prepend(initialRow);

  const apiKey = geminiKeyInput.value.trim();
  let allExtractedItems = [];

  try {
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;

      for (let i = 1; i <= numPages; i++) {
        initialRow.innerHTML = `<td>${file.name}</td><td colspan="5" style="color: var(--primary); font-style: italic;">Processing Page ${i} of ${numPages}...</td>`;

        // Add a small delay to avoid rate limiting on multi-page files
        if (i > 1) await new Promise(r => setTimeout(r, 800));

        const page = await pdf.getPage(i);
        const { base64Data, text } = await processPageData(page, i);

        let pageItems = [];
        if (apiKey) {
          const isDeep = deepAnalysisCheckbox.checked;
          if (isDeep) {
            pageItems = await callDeepReasoningChain(`[PAGE ${i}]\n${text}`, apiKey, base64Data, 'image/png', initialRow);
          } else {
            pageItems = await callGemini(`[PAGE ${i}]\n${text}`, apiKey, base64Data, 'image/png', initialRow);
          }
        } else {
          pageItems = [parseInvoiceText(text)];
        }

        // Add page info to each item
        pageItems.forEach(item => {
          item.pages = i.toString();
          allExtractedItems.push(item);
        });
      }
    } else if (file.type.startsWith('image/')) {
      initialRow.innerHTML = `<td>${file.name}</td><td colspan="5" style="color: var(--primary); font-style: italic;">Processing Image...</td>`;
      const result = await Tesseract.recognize(file, 'eng');
      const text = result.data.text;
      const base64Data = await fileToBase64(file);

      if (apiKey) {
        allExtractedItems = await callGemini(text, apiKey, base64Data, file.type, initialRow);
      } else {
        allExtractedItems = [parseInvoiceText(text)];
      }
      allExtractedItems.forEach(item => item.pages = "1");
    }
  } catch (error) {
    console.error('Processing failed:', error);
    initialRow.innerHTML = `<td>${file.name}</td><td colspan="5" style="color: var(--danger); font-weight: bold;">❌ Error: ${error.message}</td>`;
    return;
  }

  // Final step: Merge consecutive pages that belong to the same invoice
  const mergedItems = mergeInvoicePages(allExtractedItems);

  // Remove the "Preparing..." row
  initialRow.remove();

  // Render rows
  mergedItems.forEach((data, index) => {
    const validation = validateExtraction(data.po, data.amount);
    const row = document.createElement('tr');

    const pageLabel = data.pages ? `<br><small style="color:var(--text-muted)">Pages: ${data.pages}</small>` : '';
    const fileLabel = mergedItems.length > 1
      ? `<strong>${file.name}</strong> <small style="display:block; color:var(--primary)">Invoice ${index + 1}${pageLabel}</small>`
      : `<strong>${file.name}</strong>${pageLabel}`;

    row.innerHTML = `
      <td>${fileLabel}</td>
      <td>${data.supplier || 'Unknown'}</td>
      <td><code>${data.invNum || 'N/A'}</code></td>
      <td><code>${data.po || 'N/A'}</code></td>
      <td><span style="font-weight: 600;">${data.amount || '£0.00'}</span></td>
      <td><span class="status-badge ${validation.class}">${validation.text}</span></td>
    `;
    resultsBody.prepend(row);
  });
}

async function processPageData(page, pageNum) {
  const viewport = page.getViewport({ scale: 1.5 }); // Balanced scale for OCR + API payload
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport: viewport }).promise;
  const base64Data = canvas.toDataURL('image/png').split(',')[1];

  const textContent = await page.getTextContent();
  const text = textContent.items.map(item => item.str).join(' ');

  return { base64Data, text };
}

function mergeInvoicePages(items) {
  if (items.length <= 1) return items;

  const merged = [];
  let current = items[0];

  for (let i = 1; i < items.length; i++) {
    const next = items[i];

    // Logic: If same supplier AND same invoice number AND consecutive pages
    // or if next page has "Unknown" but current has data (dangerous but common in multi-page)
    const isSameInvoice =
      (next.supplier === current.supplier && next.invNum === current.invNum && next.invNum !== 'N/A') ||
      (next.invNum === 'N/A' && next.supplier === current.supplier && current.invNum !== 'N/A');

    if (isSameInvoice) {
      // Merge pages range
      const currentPages = current.pages.split('-');
      const start = currentPages[0];
      const end = next.pages;
      current.pages = `${start}-${end}`;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

async function callGemini(text, apiKey, base64Data, mimeType, activeRow = null, retryCount = 0) {
  const model = discoveredModel;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`Calling ${model} via v1beta...`);

  const prompt = `
    You are a professional Invoice Auditor. Your task is to extract data from the provided image of an invoice page.
    
    INSTRUCTIONS:
    1. **Identify the Vendor**: Look for the company name, logo, and address.
    2. **Identify Invoice Details**: Find the Invoice Number and 6-digit PO number.
    3. **Total Amount**: Find the FINAL total or balance due on THIS page.
    4. **Handle Multi-Invoice Pages**: If there is more than one separate invoice on this single image, return an entry for each.

    Return ONLY a valid JSON ARRAY of objects.
    JSON Structure:
    [
      {
        "supplier": "Full Legal Name",
        "invNum": "Invoice ID",
        "po": "6-digit PO",
        "amount": "£0.00",
        "reasoning": "Briefly describe the document found"
      }
    ]

    OCR Text for context:
    ---
    ${text}
    ---
  `;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        }
      ]
    }]
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    if (response.status === 429 && retryCount < 3) {
      const waitMatch = (result.error?.message || '').match(/retry in ([\d.]+)s/i);
      const isLimitZero = (result.error?.message || '').includes('limit: 0');

      if (isLimitZero) {
        throw new Error(`Quota Limit is 0 for ${model}. Please ensure your API key has access to Gemini 1.5 Flash.`);
      }

      const waitTime = waitMatch ? (parseFloat(waitMatch[1]) + 2) * 1000 : 30000;

      if (activeRow) {
        const originalContent = activeRow.innerHTML;
        activeRow.innerHTML = originalContent.replace(/Processing Page \d+ of \d+\.\.\./, `⏳ Waiting for Quota (${Math.round(waitTime / 1000)}s)...`);
        await new Promise(r => setTimeout(r, waitTime));
        activeRow.innerHTML = originalContent; // Restore
      } else {
        await new Promise(r => setTimeout(r, waitTime));
      }
      return callGemini(text, apiKey, base64Data, mimeType, activeRow, retryCount + 1);
    }
    console.error('Gemini API Details:', result);
    throw new Error(result.error?.message || `API Error: ${response.status}`);
  }

  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('No candidate returned from Gemini');
  }

  const content = result.candidates[0].content.parts[0].text;
  const jsonMatch = content.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    const objMatch = content.match(/\{[\s\S]*\}/);
    return objMatch ? [JSON.parse(objMatch[0])] : [];
  }

  return JSON.parse(jsonMatch[0]);
}

async function callDeepReasoningChain(text, apiKey, base64Data, mimeType, activeRow = null) {
  console.log('Starting Deep Analysis (Dual-Pass Flash)...');

  // Step 1: Initial extraction
  const initialDraft = await callGemini(text, apiKey, base64Data, mimeType, activeRow);
  console.log('Draft generated:', initialDraft);

  // Step 2: Second pass for auditing (also using Flash for quota reliability)
  const auditPrompt = `
    You are a Lead Financial Controller auditing a single invoice page.
    
    Draft Data to Verify:
    ${JSON.stringify(initialDraft, null, 2)}
    
    INSTRUCTIONS:
    1. **Verify the Supplier**: Is there any other company name on this page?
    2. **Verify Amounts**: Is there a larger "Total" or "Balance" that was missed?
    3. **PO Number**: Confirm the 6-digit PO.
    
    Return the final corrected JSON ARRAY.
    [
      {
        "supplier": "...",
        "invNum": "...",
        "po": "...",
        "amount": "...",
        "audit_notes": "Corrections made"
      }
    ]

    OCR Context:
    ---
    ${text}
    ---
  `;

  if (activeRow) {
    const originalContent = activeRow.innerHTML;
    activeRow.innerHTML = originalContent.replace(/Processing Page \d+ of \d+\.\.\./, `⏳ Deep Auditing...`);
    const finalResults = await callGemini(auditPrompt, apiKey, base64Data, mimeType, activeRow);
    activeRow.innerHTML = originalContent; // Restore
    return finalResults;
  } else {
    return await callGemini(auditPrompt, apiKey, base64Data, mimeType);
  }
}


async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
}

function parseInvoiceText(text) {
  // Clean text: remove multiple spaces and normalize newlines
  const cleanText = text.replace(/[ ]+/g, ' ').trim();
  console.log('Cleaned Extracted Text:', cleanText);

  // Regex patterns
  const patterns = {
    po: /(?:PO[:\s]*|Reference\s*PO\s*|Order No[:\s]*|PO Number[:\s]*)(\d{6})/i,
    invNum: /(?:Invoice Number|Invoice No|Number|Inv #|Invoice #|Ref)[:\s]*([0-9]{4,}|[A-Z0-9-/]{4,})/i,
    // Use global flag to find all amounts and then pick the last one (usually the total)
    amount: /(?:Amount Due|TOTAL:?|Total Amount|Invoice Total|Balance Due|Total GBP|TOTAL:? £|Amount Due GBP)\s*[£$]?\s*([\d,]+\.\d{2})/gi,
    // Look for company names in the first 10 lines
    supplier: /([A-Z][A-Za-z0-9& ]+(?:Ltd|Limited|Consultancy|Designs|Design|Scaffold|Structural))/
  };

  const data = {
    supplier: 'Unknown Vendor',
    invNum: 'N/A',
    po: 'N/A',
    amount: '£0.00'
  };

  const poMatch = cleanText.match(patterns.po);
  if (poMatch) data.po = poMatch[1];

  const invMatch = cleanText.match(patterns.invNum);
  if (invMatch) data.invNum = invMatch[1];

  // Find all amount matches
  const amountMatches = Array.from(cleanText.matchAll(patterns.amount));
  if (amountMatches.length > 0) {
    // Pick the LAST match, which is usually the total at the bottom of the invoice
    const lastMatch = amountMatches[amountMatches.length - 1];
    data.amount = '£' + lastMatch[1];
  }

  // Vendor detection: check for keywords first
  const lowerText = cleanText.toLowerCase();
  if (lowerText.includes('raptor scaffold')) data.supplier = 'Raptor Scaffold Design';
  else if (lowerText.includes('prime scaffold')) data.supplier = 'Prime Scaffold Designs';
  else if (lowerText.includes('kaefer')) data.supplier = 'KAEFER Ltd';
  else {
    // If no keyword match, try the regex on the first part of the text
    const header = cleanText.split('\n').slice(0, 10).join('\n');
    const supplierMatch = header.match(patterns.supplier);
    if (supplierMatch) data.supplier = supplierMatch[1].trim();
  }

  return data;
}

function validateExtraction(poNum, amountStr) {
  const po = poData.find(p => p.po === poNum);

  if (!po) {
    return { text: 'Invalid PO', class: 'status-error' };
  }

  // Clean amounts for comparison (remove £ and commas)
  const cleanExtract = amountStr.replace(/[£,]/g, '');
  const cleanPO = po.amount.replace(/[£,]/g, '');

  if (parseFloat(cleanExtract) !== parseFloat(cleanPO)) {
    return { text: 'Invalid Amount', class: 'status-error' };
  }

  // Return the actual status from the PO table
  const statusClassMap = {
    'Pending': 'status-pending',
    'Prelim received': 'status-prelim',
    'Const received': 'status-const',
    'Inv. Approved': 'status-approved'
  };

  return { text: po.status, class: statusClassMap[po.status] || 'status-prelim' };
}

// getMockData removed as it is replaced by parseInvoiceText

// --- PO MANAGEMENT LOGIC ---
const poForm = document.getElementById('po-form');
const poBody = document.getElementById('po-body');
const poSearch = document.getElementById('po-search');
const importPoBtn = document.getElementById('import-po-btn');
const poImportInput = document.getElementById('po-import-input');

let poData = [
  { supplier: 'Raptor Ltd', po: '337938', amount: '£3648.00', status: 'Inv. Approved', designer: 'R. Gonzalez', title: 'Main Stage Build', ref: '24/Rap/451' },
  { supplier: 'Prime Designs', po: '336680', amount: '£1080.00', status: 'Pending', designer: 'J. Doe', title: 'Phase 1 Options', ref: 'PSD-13544' }
];

let statusLogData = [
  { timestamp: new Date().toLocaleString(), po: '337938', title: 'Main Stage Build', supplier: 'Raptor Ltd', oldStatus: 'N/A', newStatus: 'Inv. Approved' },
  { timestamp: new Date().toLocaleString(), po: '336680', title: 'Phase 1 Options', supplier: 'Prime Designs', oldStatus: 'N/A', newStatus: 'Pending' }
];

const registerBody = document.getElementById('register-body');
const clearLogBtn = document.getElementById('clear-log-btn');
const registerSearch = document.getElementById('register-search');

function logStatusChange(po, title, supplier, oldStatus, newStatus) {
  const entry = {
    timestamp: new Date().toLocaleString(),
    po,
    title,
    supplier,
    oldStatus,
    newStatus
  };
  statusLogData.unshift(entry);
  renderStatusLog();
}

function renderStatusLog() {
  const searchTerm = registerSearch.value.toLowerCase();
  registerBody.innerHTML = '';

  const filteredLogs = statusLogData.filter(log =>
    log.po.toLowerCase().includes(searchTerm) ||
    (log.title && log.title.toLowerCase().includes(searchTerm))
  );

  filteredLogs.forEach((log) => {
    const originalIndex = statusLogData.indexOf(log);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${log.timestamp}</td>
      <td><code>${log.po}</code></td>
      <td>${log.title || 'N/A'}</td>
      <td>${log.supplier}</td>
      <td><span style="color: var(--text-muted)">${log.oldStatus}</span></td>
      <td><span class="status-badge ${getStatusClass(log.newStatus)}">${log.newStatus}</span></td>
      <td>
        <button class="btn secondary delete-log-btn" style="padding: 0.4rem; color: var(--danger);" data-index="${originalIndex}">Delete</button>
      </td>
    `;
    registerBody.appendChild(row);
  });

  registerBody.querySelectorAll('.delete-log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      statusLogData.splice(index, 1);
      renderStatusLog();
    });
  });
}

function getStatusClass(status) {
  const statusClassMap = {
    'Pending': 'status-pending',
    'Prelim received': 'status-prelim',
    'Const received': 'status-const',
    'Inv. Approved': 'status-approved'
  };
  return statusClassMap[status] || 'status-prelim';
}

function renderPOs() {
  const searchTerm = poSearch.value.toLowerCase();
  poBody.innerHTML = '';

  const filteredData = poData.filter(item =>
    item.supplier.toLowerCase().includes(searchTerm) ||
    item.po.toLowerCase().includes(searchTerm) ||
    item.title.toLowerCase().includes(searchTerm) ||
    item.designer.toLowerCase().includes(searchTerm)
  );

  filteredData.forEach((item) => {
    const originalIndex = poData.indexOf(item);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td contenteditable="true" class="editable" data-field="supplier" data-index="${originalIndex}">${item.supplier}</td>
      <td contenteditable="true" class="editable" data-field="po" data-index="${originalIndex}">${item.po}</td>
      <td contenteditable="true" class="editable" data-field="amount" data-index="${originalIndex}">${item.amount}</td>
      <td contenteditable="true" class="editable" data-field="title" data-index="${originalIndex}">${item.title}</td>
      <td contenteditable="true" class="editable" data-field="designer" data-index="${originalIndex}">${item.designer}</td>
      <td>
        <select class="status-select" data-index="${originalIndex}">
          <option value="Pending" ${item.status === 'Pending' ? 'selected' : ''}>Pending</option>
          <option value="Prelim received" ${item.status === 'Prelim received' ? 'selected' : ''}>Prelim received</option>
          <option value="Const received" ${item.status === 'Const received' ? 'selected' : ''}>Const received</option>
          <option value="Inv. Approved" ${item.status === 'Inv. Approved' ? 'selected' : ''}>Inv. Approved</option>
        </select>
      </td>
      <td>
        <button class="btn secondary delete-btn" style="padding: 0.4rem; color: var(--danger);" data-index="${originalIndex}">Delete</button>
      </td>
    `;
    poBody.appendChild(row);
  });

  // Attach event listeners for inline editing
  poBody.querySelectorAll('.editable').forEach(cell => {
    cell.addEventListener('blur', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      const field = e.target.getAttribute('data-field');
      poData[index][field] = e.target.innerText;
    });
  });

  poBody.querySelectorAll('.status-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      const item = poData[index];
      const oldStatus = item.status;
      const newStatus = e.target.value;

      if (oldStatus !== newStatus) {
        logStatusChange(item.po, item.title, item.supplier, oldStatus, newStatus);
        item.status = newStatus;
      }

      updateStatusDisplay(e.target);
    });
    updateStatusDisplay(select);
  });

  poBody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      poData.splice(index, 1);
      renderPOs();
    });
  });
}

function updateStatusDisplay(select) {
  const val = select.value;
  select.className = 'status-select';
  if (val === 'Pending') select.style.color = 'var(--warning)';
  if (val === 'Prelim received') select.style.color = 'var(--primary)';
  if (val === 'Const received') select.style.color = 'var(--accent)';
  if (val === 'Inv. Approved') select.style.background = 'var(--accent)';
  if (val === 'Inv. Approved') select.style.color = 'white';
}

poForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newItem = {
    supplier: document.getElementById('po-supplier').value,
    po: document.getElementById('po-number').value,
    amount: document.getElementById('po-amount').value,
    status: document.getElementById('po-status').value,
    designer: document.getElementById('po-designer').value,
    title: document.getElementById('po-title').value,
    ref: document.getElementById('po-ref').value,
  };
  poData.unshift(newItem);
  logStatusChange(newItem.po, newItem.title, newItem.supplier, 'N/A (Created)', newItem.status);
  renderPOs();
  poForm.reset();
});

clearLogBtn.addEventListener('click', () => {
  statusLogData = [];
  renderStatusLog();
});

// Search listeners
poSearch.addEventListener('input', () => {
  renderPOs();
});

registerSearch.addEventListener('input', () => {
  renderStatusLog();
});

// PO Import handlers
importPoBtn.addEventListener('click', () => poImportInput.click());

poImportInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const text = event.target.result;
    const lines = text.split('\n');
    const newItems = [];

    // Assume header: Supplier, PO, Amount, Title, Designer, Status, Ref
    // If some fields missing, we use defaults
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      if (cols.length < 3) continue; // Min required fields

      const item = {
        supplier: cols[0] || 'Unknown',
        po: cols[1] || '000000',
        amount: cols[2] || '£0.00',
        title: cols[3] || 'N/A',
        designer: cols[4] || 'N/A',
        status: cols[5] || 'Pending',
        ref: cols[6] || ''
      };

      // Basic formatting cleanup
      if (!item.amount.startsWith('£')) item.amount = '£' + item.amount;

      newItems.push(item);
      logStatusChange(item.po, item.title, item.supplier, 'N/A (Bulk Import)', item.status);
    }

    if (newItems.length > 0) {
      poData = [...newItems, ...poData]; // Newest first
      renderPOs();
      alert(`Successfully imported ${newItems.length} purchase orders.`);
    }

    poImportInput.value = ''; // Reset
  };
  reader.readAsText(file);
});

// Clear Extracts listener
clearBtn.addEventListener('click', () => {
  resultsBody.innerHTML = '';
  resultsSection.style.display = 'none';
});

// Download CSV listener
downloadBtn.addEventListener('click', () => {
  const rows = Array.from(resultsBody.querySelectorAll('tr'));
  if (rows.length === 0) return;

  const csvRows = [];
  csvRows.push("Filename,Supplier,Invoice #,PO Number,Total Amount,Status");

  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 6) return; // Skip error rows
    const rowData = cells.map(td => `"${td.innerText.replace(/"/g, '""')}"`);
    csvRows.push(rowData.join(","));
  });

  const csvString = csvRows.join("\n");
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "extracted_invoices.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Initial render
renderPOs();
renderStatusLog();
