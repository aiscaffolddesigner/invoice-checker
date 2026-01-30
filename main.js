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

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(99, 102, 241, 0.05)'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.background = 'transparent'; });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.background = 'transparent';
  handleFiles(e.dataTransfer.files);
});

async function handleFiles(files) {
  if (files.length === 0) return;
  scanningLine.style.display = 'block';
  resultsSection.style.display = 'block';
  for (const file of files) { await processFile(file); }
  scanningLine.style.display = 'none';
}

async function processFile(file) {
  return new Promise((resolve) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${file.name}</td><td colspan="3" style="color: var(--text-muted); font-style: italic;">Analyzing...</td><td><span class="status-badge status-prelim">Processing</span></td>`;
    resultsBody.prepend(row);

    setTimeout(() => {
      const mockData = getMockData(file.name);
      const validation = validateExtraction(mockData.po, mockData.amount);

      row.innerHTML = `
        <td><strong>${file.name}</strong></td>
        <td>${mockData.supplier}</td>
        <td><code>${mockData.invNum}</code></td>
        <td><code>${mockData.po}</code></td>
        <td><span style="font-weight: 600;">${mockData.amount}</span></td>
        <td><span class="status-badge ${validation.class}">${validation.text}</span></td>
      `;
      resolve();
    }, 1200);
  });
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

function getMockData(filename) {
  const name = filename.toLowerCase();
  // Ensure PO numbers are strictly 6 digits as per user request
  if (name.includes('raptor')) return { supplier: 'Raptor Scaffold Design', invNum: '6415', po: '337938', amount: '£3648.00' };
  if (name.includes('psd') || name.includes('prime')) return { supplier: 'Prime Scaffold Designs', invNum: '14059', po: '336680', amount: '£1080.00' };
  if (name.includes('7-144')) return { supplier: 'Raptor Scaffold Design', invNum: '6435', po: '337801', amount: '£2280.00' };
  return { supplier: 'Generic Vendor Ltd', invNum: 'INV-1001', po: '123456', amount: '£450.00' };
}

// --- PO MANAGEMENT LOGIC ---
const poForm = document.getElementById('po-form');
const poBody = document.getElementById('po-body');
const poSearch = document.getElementById('po-search');

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

// Clear Extracts listener
clearBtn.addEventListener('click', () => {
  resultsBody.innerHTML = '';
  resultsSection.style.display = 'none';
});

// Initial render
renderPOs();
renderStatusLog();
