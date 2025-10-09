// Financial Tracking JavaScript
let currentUser = null;
let userAccounts = [];
let recentTransactions = [];

// Use centralized API_CONFIG from config.js

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
  initializePage();
});

// Refresh data when page becomes visible (e.g., when navigating back from accounts page)
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    console.log('🔄 Page became visible, refreshing data...');
    // Force refresh of financial summary to get latest data
    loadUserData();
  }
});

async function initializePage() {
  try {
    // Log API configuration for debugging
    API_CONFIG.logConfig();
    
    // Check if user is authenticated
    if (!window.msalInstance) {
      // Initialize MSAL if not already done
      const msalConfig = {
        auth: {
          clientId: 'e8c1227e-f95c-4a0a-bf39-f3ce4c78c781',
          authority: 'https://PanduhzProject.b2clogin.com/PanduhzProject.onmicrosoft.com/B2C_1_testonsiteflow',
          knownAuthorities: ['PanduhzProject.b2clogin.com'],
          redirectUri: window.location.origin,
        },
      };
      
      window.msalInstance = new msal.PublicClientApplication(msalConfig);
      window.msalInstance.enableAccountStorageEvents();
    }

    const accounts = window.msalInstance.getAllAccounts();
    
    if (accounts && accounts.length > 0) {
      const account = accounts[0];
      currentUser = {
        id: account.idTokenClaims.oid,
        name: `${account.idTokenClaims.given_name} ${account.idTokenClaims.family_name}`,
        email: account.idTokenClaims.emails[0]
      };
      
      // Update UI with user info
      document.getElementById('userName').textContent = `Welcome, ${currentUser.name}!`;
      
      // Load user data
      await loadUserData();
    } else {
      // Redirect to login if not authenticated
      window.location.replace('/index.html');
    }
  } catch (error) {
    console.error('Error initializing page:', error);
    showMessage('Error initializing page. Please try again.', 'error');
  }
}

async function loadUserData() {
  try {
    showLoading(true);
    
    // Load accounts and transactions first
    await Promise.all([
      loadUserAccounts(),
      loadRecentTransactions()
    ]);
    
    // Load chart separately with error handling
    try {
      await loadAccountBalanceChart();
    } catch (error) {
      console.error('Error loading chart:', error);
      // Don't let chart errors break the page
    }
    
    // Update dashboard
    updateDashboard();
    
  } catch (error) {
    console.error('Error loading user data:', error);
    showMessage('Error loading data. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadUserAccounts() {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts`, {
      method: 'GET'
    });
    
    if (response.ok) {
      userAccounts = await response.json();
      populateAccountSelect();
    } else {
      console.log('No accounts found or error loading accounts. Status:', response.status);
      userAccounts = [];
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
    userAccounts = [];
  }
}

async function loadRecentTransactions() {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions/recent`, {
      method: 'GET'
    });
    
    if (response.ok) {
      recentTransactions = await response.json();
      displayRecentTransactions();
    } else {
      console.log('No transactions found or error loading transactions');
      recentTransactions = [];
    }
  } catch (error) {
    console.error('Error loading transactions:', error);
    recentTransactions = [];
  }
}

function updateDashboard() {
  // Update total accounts
  document.getElementById('totalAccounts').textContent = userAccounts.length;
  
  // Update total balance
  const totalBalance = userAccounts.reduce((sum, account) => {
    const balance = account.current_balance || 0;
    return sum + balance;
  }, 0);
  document.getElementById('totalBalance').textContent = `$${totalBalance.toFixed(2)}`;
  
  // Update monthly transactions
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyCount = recentTransactions.filter(t => {
    const transactionDate = new Date(t.transaction_date);
    return transactionDate.getMonth() === currentMonth && transactionDate.getFullYear() === currentYear;
  }).length;
  
  document.getElementById('monthlyTransactions').textContent = `${monthlyCount} transactions`;
}

function populateAccountSelect() {
  const select = document.getElementById('transactionAccount');
  select.innerHTML = '<option value="">Select an account</option>';
  
  userAccounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.account_id;
    option.textContent = `${account.account_name} (${account.account_type}) - $${account.current_balance.toFixed(2)}`;
    select.appendChild(option);
  });
}

// Use centralized formatTransactionDate from utils.js

function displayRecentTransactions() {
  const container = document.getElementById('recentTransactions');
  
  if (recentTransactions.length === 0) {
    container.innerHTML = '<p class="no-data">No recent transactions found. Create an account and add some transactions to get started!</p>';
    return;
  }
  
  container.innerHTML = recentTransactions.slice(0, 5).map(transaction => {
    const amount = parseFloat(transaction.amount);
    const transactionType = transaction.transaction_type;
    
    // Determine display based on transaction type
    let amountClass, amountDisplay;
    if (transactionType === 'income') {
      amountClass = 'income';
      amountDisplay = `+$${amount.toFixed(2)}`;
    } else if (transactionType === 'expense') {
      amountClass = 'expense';
      amountDisplay = `-$${amount.toFixed(2)}`;
    } else {
      // For transfers, you might want different logic
      amountClass = 'expense';
      amountDisplay = `-$${amount.toFixed(2)}`;
    }
    
    return `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-description">${transaction.description}</div>
          <div class="transaction-details">${transaction.category} • ${formatTransactionDate(transaction.transaction_date)}</div>
        </div>
        <div class="transaction-amount ${amountClass}">${amountDisplay}</div>
      </div>
    `;
  }).join('');
}

// Modal Functions
function openCreateAccountModal() {
  document.getElementById('createAccountModal').style.display = 'block';
  document.getElementById('createAccountForm').reset();
  
  // Set default date to today
  document.getElementById('accountCreationDate').value = new Date().toISOString().split('T')[0];
  
  // Prevent background scrolling
  document.body.style.overflow = 'hidden';
}

function closeCreateAccountModal() {
  document.getElementById('createAccountModal').style.display = 'none';
  
  // Restore background scrolling
  document.body.style.overflow = 'auto';
}

function openAddTransactionModal() {
  if (userAccounts.length === 0) {
    showMessage('Please create a bank account first before adding transactions.', 'error');
    return;
  }
  
  document.getElementById('addTransactionModal').style.display = 'block';
  document.getElementById('addTransactionForm').reset();
  
  // Set default date to today
  document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
  
  // Prevent background scrolling
  document.body.style.overflow = 'hidden';
}

function closeAddTransactionModal() {
  document.getElementById('addTransactionModal').style.display = 'none';
  
  // Restore background scrolling
  document.body.style.overflow = 'auto';
}

function toggleRecurringOptions() {
  try {
    const transactionType = document.getElementById('transactionType').value;
    const recurringOptions = document.getElementById('recurringOptions');
    
    if (!recurringOptions) {
      console.error('recurringOptions element not found');
      return;
    }
    
    if (transactionType === 'recurring_expense' || transactionType === 'recurring_income') {
      recurringOptions.style.display = 'block';
      
      // Disable the regular date field for recurring transactions
      const transactionDateInput = document.getElementById('transactionDate');
      const dateNote = document.getElementById('dateNote');
      if (transactionDateInput) {
        transactionDateInput.disabled = true;
        transactionDateInput.style.backgroundColor = '#f5f5f5';
        transactionDateInput.style.color = '#999';
      }
      if (dateNote) {
        dateNote.style.display = 'block';
      }
      
      // Set default subscription start date to 1 month ago
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const startDateInput = document.getElementById('subscriptionStartDate');
      if (startDateInput) {
        startDateInput.value = oneMonthAgo.toISOString().split('T')[0];
      }
    } else {
      recurringOptions.style.display = 'none';
      
      // Re-enable the regular date field for non-recurring transactions
      const transactionDateInput = document.getElementById('transactionDate');
      const dateNote = document.getElementById('dateNote');
      if (transactionDateInput) {
        transactionDateInput.disabled = false;
        transactionDateInput.style.backgroundColor = '';
        transactionDateInput.style.color = '';
      }
      if (dateNote) {
        dateNote.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error in toggleRecurringOptions:', error);
  }
}

// Make function globally available
window.toggleRecurringOptions = toggleRecurringOptions;

// Form Handlers
document.getElementById('createAccountForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const accountData = {
    account_name: formData.get('accountName'),
    account_type: formData.get('accountType'),
    bank_name: formData.get('bankName') || '',
    initial_balance: parseFloat(formData.get('initialBalance')) || 0,
    account_creation_date: formData.get('accountCreationDate') || new Date().toISOString().split('T')[0],
    description: formData.get('accountDescription') || ''
  };
  
  try {
    showLoading(true);
    
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts`, {
      method: 'POST',
      body: JSON.stringify(accountData)
    });
    
    if (response.ok) {
      const newAccount = await response.json();
      userAccounts.push(newAccount);
      
      // Invalidate cache after successful account creation
      if (window.cacheInvalidation) {
        window.cacheInvalidation.invalidateUserData();
      }
      
      showMessage('Bank account created successfully!', 'success');
      closeCreateAccountModal();
      updateDashboard();
      populateAccountSelect();
    } else {
      const error = await response.json();
      showMessage(error.message || 'Error creating account', 'error');
    }
  } catch (error) {
    console.error('Error creating account:', error);
    showMessage('Error creating account. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
});

document.getElementById('addTransactionForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const transactionType = formData.get('transactionType');
  const isRecurring = transactionType === 'recurring_expense' || transactionType === 'recurring_income';
  
  // Convert recurring transaction types to base types
  let baseTransactionType = transactionType;
  if (transactionType === 'recurring_expense') {
    baseTransactionType = 'expense';
  } else if (transactionType === 'recurring_income') {
    baseTransactionType = 'income';
  }
  
  // For recurring transactions, use the subscription start date as the transaction date
  let transactionDate;
  if (isRecurring) {
    transactionDate = formData.get('subscriptionStartDate');
  } else {
    transactionDate = formData.get('transactionDate') || new Date().toISOString().split('T')[0];
  }
  
  const transactionData = {
    account_id: formData.get('transactionAccount'),
    amount: parseFloat(formData.get('transactionAmount')),
    description: formData.get('transactionDescription'),
    category: formData.get('transactionCategory'),
    transaction_type: baseTransactionType,
    transaction_date: transactionDate,
    is_recurring: isRecurring,
    recurring_frequency: isRecurring ? formData.get('frequency') : null,
    recurring_start_date: isRecurring ? formData.get('subscriptionStartDate') : null
  };
  
  try {
    showLoading(true);
    
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions`, {
      method: 'POST',
      body: JSON.stringify(transactionData)
    });
    
    if (response.ok) {
      // Invalidate cache BEFORE updating local data
      if (window.cacheInvalidation) {
        console.log('🗑️ Invalidating cache after transaction creation');
        window.cacheInvalidation.invalidateTransactionData();
        window.cacheInvalidation.invalidateUserData(); // Also invalidate user data for financial summary
      }
      
      const newTransaction = await response.json();
      recentTransactions.unshift(newTransaction);
      
      // Update account balance based on transaction type
      const account = userAccounts.find(acc => acc.account_id === transactionData.account_id);
      if (account) {
        if (transactionData.transaction_type === 'income') {
          account.current_balance += transactionData.amount;
        } else if (transactionData.transaction_type === 'expense') {
          account.current_balance -= transactionData.amount;
        }
      }
      
      // Force refresh of financial summary to get updated totals
      await loadUserData();
      
      if (isRecurring) {
        showMessage('Recurring transaction added successfully! Historical transactions have been created.', 'success');
      } else {
        showMessage('Transaction added successfully!', 'success');
      }
      closeAddTransactionModal();
      updateDashboard();
      displayRecentTransactions();
      populateAccountSelect();
    } else {
      const error = await response.json();
      showMessage(error.message || 'Error adding transaction', 'error');
    }
  } catch (error) {
    console.error('Error adding transaction:', error);
    showMessage('Error adding transaction. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
});

// Use centralized utility functions from utils.js

function viewAllAccounts() {
  window.location.href = window.getNavigationUrl('/accounts', '/accounts.html');
}

// Upload Modal Functions
function openUploadModal() {
  document.getElementById('uploadModal').style.display = 'block';
  
  // Populate account select
  populateUploadAccountSelect();
  
  // Reset form
  document.getElementById('statementFile').value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('uploadResults').style.display = 'none';
  document.getElementById('processBtn').disabled = true;
  
  // Prevent background scrolling
  document.body.style.overflow = 'hidden';
}

function closeUploadModal() {
  document.getElementById('uploadModal').style.display = 'none';
  
  // Restore background scrolling
  document.body.style.overflow = 'auto';
}

function populateUploadAccountSelect() {
  const select = document.getElementById('targetAccount');
  select.innerHTML = '<option value="">-- Select an account or create new --</option>';
  
  // Add "Create New Account" option
  const createNewOption = document.createElement('option');
  createNewOption.value = 'create_new';
  createNewOption.textContent = 'Create New Account';
  select.appendChild(createNewOption);
  
  // Add existing accounts
  if (userAccounts && userAccounts.length > 0) {
    userAccounts.forEach(account => {
      const option = document.createElement('option');
      option.value = account.account_id;
      option.textContent = `${account.account_name} (${account.account_type}) - $${account.current_balance.toFixed(2)}`;
      select.appendChild(option);
    });
  }
}

// File selection handler
document.addEventListener('DOMContentLoaded', function() {
  const fileInput = document.getElementById('statementFile');
  const targetAccountSelect = document.getElementById('targetAccount');
  const processBtn = document.getElementById('processBtn');
  
  function updateProcessButton() {
    const hasFile = fileInput && fileInput.files[0];
    const hasTargetAccount = targetAccountSelect && targetAccountSelect.value;
    processBtn.disabled = !(hasFile && hasTargetAccount);
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        // Show file info
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = formatFileSize(file.size);
        document.getElementById('fileInfo').style.display = 'block';
      } else {
        document.getElementById('fileInfo').style.display = 'none';
      }
      updateProcessButton();
    });
  }
  
  if (targetAccountSelect) {
    targetAccountSelect.addEventListener('change', updateProcessButton);
  }
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getAuthToken() {
  try {
    const account = window.msalInstance.getAllAccounts()[0];
    if (!account) {
      throw new Error('User not authenticated');
    }
    
    const tokenResponse = await window.msalInstance.acquireTokenSilent({
      scopes: ['https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user'],
      account: account
    });
    
    return tokenResponse.accessToken;
  } catch (error) {
    console.error('Error getting auth token:', error);
    throw error;
  }
}

async function processStatement() {
  const fileInput = document.getElementById('statementFile');
  const targetAccount = document.getElementById('targetAccount').value;
  const processBtn = document.getElementById('processBtn');
  const resultsDiv = document.getElementById('uploadResults');
  const resultsContent = document.getElementById('uploadResultsContent');
  
  if (!fileInput.files[0]) {
    showMessage('Please select a file first', 'error');
    return;
  }
  
  if (!targetAccount) {
    showMessage('Please select a target account or choose "Create New Account"', 'error');
    return;
  }
  
  try {
    // Show loading state
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    resultsDiv.style.display = 'block';
    resultsContent.innerHTML = '<div class="upload-loading">Processing your bank statement...</div>';
    
    // Create form data
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    if (targetAccount && targetAccount !== 'create_new') {
      formData.append('target_account_id', targetAccount);
    }
    // If targetAccount is 'create_new', we don't send target_account_id
    // This tells the backend to create a new account
    
    // Make API request to document processing endpoint
    // Using the centralized upload API configuration
    const response = await fetch(`${API_CONFIG.getUploadApiUrl()}/financialUpload`, {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${await getAuthToken()}`
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      displayUploadResults(result);
      
      // Invalidate cache to refresh data
      if (window.cacheInvalidation) {
        window.cacheInvalidation.invalidateUserData();
        window.cacheInvalidation.invalidateTransactionData();
      }
      
      // Refresh the page data
      await loadUserData();
      
    } else {
      const error = await response.json();
      resultsContent.innerHTML = `<div class="upload-error">Error: ${error.error || 'Failed to process statement'}</div>`;
    }
    
  } catch (error) {
    console.error('Error processing statement:', error);
    resultsContent.innerHTML = `<div class="upload-error">Error: ${error.message}</div>`;
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = 'Process Statement';
  }
}

// Global variable to store extracted data for editing
let extractedData = null;

function displayUploadResults(data) {
  const resultsContent = document.getElementById('uploadResultsContent');
  const editMode = document.getElementById('uploadEditMode');
  
  // Store the data for editing
  extractedData = data;
  
  let html = '';
  
  if (data.error) {
    html = `<div class="upload-error">Error: ${data.error}</div>`;
  } else {
    // Check for missing data that requires editing
    const missingDataIssues = checkForMissingData(data);
    
    // Show success message
    html += `<div class="upload-success">Statement processed successfully!</div>`;
    
    // Show integration status message if available
    if (data.integration_message) {
      html += `<div class="upload-field">
        <div class="upload-field-label">Status</div>
        <div class="upload-field-value">${data.integration_message}</div>
      </div>`;
    }
    
    // Account Information
    if (data.account_number) {
      html += `<div class="upload-field">
        <div class="upload-field-label">Account Number</div>
        <div class="upload-field-value">${data.account_number}</div>
      </div>`;
    }
    
    if (data.starting_balance !== null && data.starting_balance !== undefined) {
      html += `<div class="upload-field">
        <div class="upload-field-label">Starting Balance</div>
        <div class="upload-field-value">$${data.starting_balance.toFixed(2)}</div>
      </div>`;
    }
    
    if (data.ending_balance !== null && data.ending_balance !== undefined) {
      html += `<div class="upload-field">
        <div class="upload-field-label">Ending Balance</div>
        <div class="upload-field-value">$${data.ending_balance.toFixed(2)}</div>
      </div>`;
    }
    
    // Transactions
    if (data.transactions && data.transactions.length > 0) {
      html += `<div class="upload-transactions">
        <h4>Transactions Found (${data.transactions.length})</h4>`;
      
      data.transactions.forEach((transaction, index) => {
        html += `<div class="upload-transaction">
          <div class="upload-transaction-header">Transaction ${index + 1}</div>
          <div class="upload-transaction-details">`;
        
        if (transaction.date) {
          html += `<strong>Date:</strong> ${transaction.date}<br>`;
        }
        if (transaction.description) {
          html += `<strong>Description:</strong> ${transaction.description}<br>`;
        }
        if (transaction.amount) {
          const amount = transaction.amount.toFixed(2);
          const sign = transaction.type === 'deposit' ? '+' : '-';
          html += `<strong>Amount:</strong> ${sign}$${amount} (${transaction.type})`;
        }
        
        html += `</div></div>`;
      });
      
      html += `</div>`;
    } else {
      html += `<div class="upload-field">
        <div class="upload-field-label">Transactions</div>
        <div class="upload-field-value">No transactions found</div>
      </div>`;
    }
    
    // Check if we need to auto-prompt for editing
    if (missingDataIssues.length > 0) {
      // Show warning about missing data
      html += `<div class="upload-warning">
        <h4>⚠️ Data Review Required</h4>
        <p>The following issues were found that need your attention:</p>
        <ul>`;
      
      missingDataIssues.forEach(issue => {
        html += `<li>${issue}</li>`;
      });
      
      html += `</ul>
        <p><strong>Please review and edit the data before saving.</strong></p>
      </div>`;
      
      // Auto-open edit mode after a short delay
      setTimeout(() => {
        enableEditMode();
        highlightMissingFields(missingDataIssues);
      }, 1500);
    } else {
      // Add edit button for optional editing
      html += `<div style="margin-top: 20px; text-align: center;">
        <button type="button" class="btn btn-primary" onclick="enableEditMode()">Edit Data Before Saving</button>
      </div>`;
    }
  }
  
  resultsContent.innerHTML = html;
}

function checkForMissingData(data) {
  const issues = [];
  
  // Check transactions for missing dates or descriptions
  if (data.transactions && data.transactions.length > 0) {
    data.transactions.forEach((transaction, index) => {
      // Check for missing or invalid dates
      const date = transaction.date;
      if (!date || 
          date.trim() === '' || 
          date.toLowerCase() === 'none' || 
          date.toLowerCase() === 'null' ||
          date === 'None' ||
          date === 'null') {
        issues.push(`Transaction ${index + 1} is missing a date`);
      }
      
      // Check for missing or invalid descriptions
      const description = transaction.description;
      if (!description || 
          description.trim() === '' || 
          description.toLowerCase() === 'none' || 
          description.toLowerCase() === 'null' ||
          description === 'None' ||
          description === 'null') {
        issues.push(`Transaction ${index + 1} is missing a description`);
      }
    });
  }
  
  return issues;
}

function highlightMissingFields(issues) {
  // Add visual indicators to missing fields in edit mode
  const transactionItems = document.querySelectorAll('.transaction-edit-item');
  
  transactionItems.forEach((item, index) => {
    const dateInput = item.querySelector('input[type="date"]');
    const descriptionInput = item.querySelector('input[type="text"]');
    
    // Check if this transaction has missing data
    const hasMissingDate = issues.some(issue => issue.includes(`Transaction ${index + 1}`) && issue.includes('date'));
    const hasMissingDescription = issues.some(issue => issue.includes(`Transaction ${index + 1}`) && issue.includes('description'));
    
    if (hasMissingDate) {
      dateInput.style.borderColor = '#dc3545';
      dateInput.style.backgroundColor = '#f8d7da';
      dateInput.placeholder = '⚠️ Date required';
    }
    
    if (hasMissingDescription) {
      descriptionInput.style.borderColor = '#dc3545';
      descriptionInput.style.backgroundColor = '#f8d7da';
      descriptionInput.placeholder = '⚠️ Description required';
    }
  });
}

function enableEditMode() {
  const resultsDiv = document.getElementById('uploadResults');
  const editMode = document.getElementById('uploadEditMode');
  
  // Hide results, show edit mode
  resultsDiv.style.display = 'none';
  editMode.style.display = 'block';
  
  // Populate edit fields with extracted data
  populateEditFields();
}

function populateEditFields() {
  if (!extractedData) return;
  
  // Populate account information
  document.getElementById('editAccountNumber').value = extractedData.account_number || '';
  document.getElementById('editStartingBalance').value = extractedData.starting_balance || 0;
  document.getElementById('editEndingBalance').value = extractedData.ending_balance || 0;
  
  // Populate transactions
  const transactionsList = document.getElementById('transactionsEditList');
  transactionsList.innerHTML = '';
  
  if (extractedData.transactions && extractedData.transactions.length > 0) {
    extractedData.transactions.forEach((transaction, index) => {
      addTransactionEditItem(transaction, index);
    });
  } else {
    // If no transactions, initialize with empty array
    extractedData.transactions = [];
  }
}

function addTransactionEditItem(transaction = null, index = null) {
  const transactionsList = document.getElementById('transactionsEditList');
  const transactionId = index !== null ? index : transactionsList.children.length;
  
  const transactionItem = document.createElement('div');
  transactionItem.className = 'transaction-edit-item';
  transactionItem.innerHTML = `
    <input type="date" placeholder="Date" value="${transaction?.date || ''}" onchange="updateTransaction(${transactionId}, 'date', this.value)">
    <input type="text" placeholder="Description" value="${transaction?.description || ''}" onchange="updateTransaction(${transactionId}, 'description', this.value)">
    <input type="number" placeholder="Amount" step="0.01" value="${transaction?.amount || ''}" onchange="updateTransaction(${transactionId}, 'amount', this.value)">
    <select onchange="updateTransaction(${transactionId}, 'type', this.value)">
      <option value="deposit" ${transaction?.type === 'deposit' ? 'selected' : ''}>Deposit</option>
      <option value="withdrawal" ${transaction?.type === 'withdrawal' ? 'selected' : ''}>Withdrawal</option>
    </select>
    <button type="button" onclick="removeTransaction(${transactionId})">Remove</button>
  `;
  
  transactionsList.appendChild(transactionItem);
}

function addNewTransaction() {
  addTransactionEditItem();
}

function updateTransaction(index, field, value) {
  if (!extractedData.transactions) {
    extractedData.transactions = [];
  }
  
  if (!extractedData.transactions[index]) {
    extractedData.transactions[index] = {};
  }
  
  extractedData.transactions[index][field] = value;
}

function removeTransaction(index) {
  if (extractedData.transactions && extractedData.transactions[index]) {
    extractedData.transactions.splice(index, 1);
    populateEditFields(); // Refresh the display
  }
}

function cancelEdit() {
  const resultsDiv = document.getElementById('uploadResults');
  const editMode = document.getElementById('uploadEditMode');
  
  editMode.style.display = 'none';
  resultsDiv.style.display = 'block';
}

async function saveEditedData() {
  try {
    showLoading(true);
    
    // Validate that all required fields are filled
    const validationErrors = validateEditedData();
    if (validationErrors.length > 0) {
      showMessage(`Please fix the following issues before saving:\n${validationErrors.join('\n')}`, 'error');
      showLoading(false);
      return;
    }
    
    // Get the target account selection from the original upload
    const targetAccount = document.getElementById('targetAccount').value;
    
    // Prepare the edited data
    const editedData = {
      account_number: document.getElementById('editAccountNumber').value,
      starting_balance: parseFloat(document.getElementById('editStartingBalance').value) || 0,
      ending_balance: parseFloat(document.getElementById('editEndingBalance').value) || 0,
      transactions: extractedData.transactions || [],
      edited_at: new Date().toISOString(),
      status: 'edited_ready_for_save'
    };
    
    // Save to main backend
    await saveToMainBackend(editedData, targetAccount);
    
    // Also save to localStorage for backup/testing
    const savedDocuments = JSON.parse(localStorage.getItem('editedBankStatements') || '[]');
    savedDocuments.push(editedData);
    localStorage.setItem('editedBankStatements', JSON.stringify(savedDocuments));
    
    // Show success message
    showMessage('Data saved successfully to the main database!', 'success');
    
    // Close modal
    closeUploadModal();
    
  } catch (error) {
    console.error('Error saving edited data:', error);
    showMessage('Error saving data. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

function validateEditedData() {
  const errors = [];
  
  // Check transactions for missing required fields
  if (extractedData.transactions && extractedData.transactions.length > 0) {
    extractedData.transactions.forEach((transaction, index) => {
      // Check for missing or invalid dates
      const date = transaction.date;
      if (!date || 
          date.trim() === '' || 
          date.toLowerCase() === 'none' || 
          date.toLowerCase() === 'null' ||
          date === 'None' ||
          date === 'null') {
        errors.push(`Transaction ${index + 1}: Date is required`);
      }
      
      // Check for missing or invalid descriptions
      const description = transaction.description;
      if (!description || 
          description.trim() === '' || 
          description.toLowerCase() === 'none' || 
          description.toLowerCase() === 'null' ||
          description === 'None' ||
          description === 'null') {
        errors.push(`Transaction ${index + 1}: Description is required`);
      }
    });
  }
  
  return errors;
}

// Helper functions for testing
function viewSavedDocuments() {
  const savedDocuments = JSON.parse(localStorage.getItem('editedBankStatements') || '[]');
  console.log('All saved bank statement documents:', savedDocuments);
  
  if (savedDocuments.length === 0) {
    console.log('No saved documents found.');
    showMessage('No saved documents found.', 'info');
    return;
  }
  
  // Display in a readable format
  let message = `Found ${savedDocuments.length} saved document(s). Check console for details.`;
  savedDocuments.forEach((doc, index) => {
    console.log(`\n--- Document ${index + 1} ---`);
    console.log('Account Number:', doc.account_number);
    console.log('Starting Balance:', doc.starting_balance);
    console.log('Ending Balance:', doc.ending_balance);
    console.log('Transactions:', doc.transactions.length);
    console.log('Edited At:', doc.edited_at);
    console.log('Status:', doc.status);
  });
  
  showMessage(message, 'success');
}

function clearSavedDocuments() {
  localStorage.removeItem('editedBankStatements');
  console.log('All saved documents cleared.');
  showMessage('All saved documents cleared.', 'success');
}

async function saveToMainBackend(editedData, targetAccount) {
  try {
    
    let accountId;
    
    if (targetAccount === 'create_new') {
      // Create a new account first
      const accountResponse = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts`, {
        method: 'POST',
        body: JSON.stringify({
          account_name: `Bank Account ${editedData.account_number}`,
          account_type: 'checking',
          initial_balance: editedData.starting_balance,
          bank_name: 'Bank Statement Import',
          description: `Account created from bank statement import on ${new Date().toLocaleDateString()}`
        })
      });
      
      if (!accountResponse.ok) {
        const errorData = await accountResponse.json();
        throw new Error(`Failed to create account: ${errorData.error || 'Unknown error'}`);
      }
      
      const account = await accountResponse.json();
      accountId = account.account_id;
      
      showMessage(`Created new account: ${account.account_name}`, 'success');
    } else {
      // Use existing account
      accountId = targetAccount;
      showMessage(`Using existing account for transactions`, 'success');
    }
    
    // Create each transaction individually
    let createdCount = 0;
    let failedCount = 0;
    
    for (const transaction of editedData.transactions) {
      try {
        // Map document extraction types to backend types
        let transactionType = transaction.type;
        if (transaction.type === 'deposit') {
          transactionType = 'income';
        } else if (transaction.type === 'withdrawal') {
          transactionType = 'expense';
        } else {
          // Default to expense if type is unknown
          transactionType = 'expense';
        }
        
        // Validate required fields
        if (!transaction.description || !transaction.amount) {
          console.warn('Skipping transaction with missing required fields:', transaction);
          failedCount++;
          continue;
        }
        
        const transactionData = {
          account_id: accountId,
          amount: Math.abs(parseFloat(transaction.amount)), // Always positive amount
          description: transaction.description,
          category: 'Other', // Default category as requested
          transaction_type: transactionType, // 'income' or 'expense'
          transaction_date: transaction.date
        };
        
        
        const transactionResponse = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions`, {
          method: 'POST',
          body: JSON.stringify(transactionData)
        });
        
        if (transactionResponse.ok) {
          createdCount++;
        } else {
          console.error(`Failed to create transaction: ${transaction.description}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`Error creating transaction: ${transaction.description}`, error);
        failedCount++;
      }
    }
    
    // Show results
    if (createdCount > 0) {
      showMessage(`Successfully created ${createdCount} transactions!`, 'success');
    }
    
    if (failedCount > 0) {
      showMessage(`Warning: ${failedCount} transactions could not be created.`, 'error');
    }
    
    // Invalidate cache to refresh data
    if (window.cacheInvalidation) {
      window.cacheInvalidation.invalidateUserData();
      window.cacheInvalidation.invalidateTransactionData();
    }
    
  } catch (error) {
    console.error('Error saving to main backend:', error);
    throw error;
  }
}

// Make these functions available globally for testing
window.viewSavedDocuments = viewSavedDocuments;
window.clearSavedDocuments = clearSavedDocuments;

// Use centralized handleSignOut from utils.js

// Close modals when clicking outside
window.onclick = function(event) {
  const createModal = document.getElementById('createAccountModal');
  const transactionModal = document.getElementById('addTransactionModal');
  const uploadModal = document.getElementById('uploadModal');
  
  if (event.target === createModal) {
    closeCreateAccountModal();
  }
  if (event.target === transactionModal) {
    closeAddTransactionModal();
  }
  if (event.target === uploadModal) {
    closeUploadModal();
  }
}
