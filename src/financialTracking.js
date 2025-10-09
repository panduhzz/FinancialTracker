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
  select.innerHTML = '<option value="">Auto-detect or create new account</option>';
  
  userAccounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.account_id;
    option.textContent = `${account.account_name} (${account.account_type}) - $${account.current_balance.toFixed(2)}`;
    select.appendChild(option);
  });
}

// File selection handler
document.addEventListener('DOMContentLoaded', function() {
  const fileInput = document.getElementById('statementFile');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        // Show file info
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = formatFileSize(file.size);
        document.getElementById('fileInfo').style.display = 'block';
        document.getElementById('processBtn').disabled = false;
      } else {
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('processBtn').disabled = true;
      }
    });
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
  
  try {
    // Show loading state
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    resultsDiv.style.display = 'block';
    resultsContent.innerHTML = '<div class="upload-loading">Processing your bank statement...</div>';
    
    // Create form data
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    if (targetAccount) {
      formData.append('target_account_id', targetAccount);
    }
    
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

function displayUploadResults(data) {
  const resultsContent = document.getElementById('uploadResultsContent');
  let html = '';
  
  if (data.error) {
    html = `<div class="upload-error">Error: ${data.error}</div>`;
  } else {
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
    
    // Show summary of what was created (if any)
    if (data.created_account) {
      html += `<div class="upload-success">New account created: ${data.created_account.account_name}</div>`;
    }
    
    if (data.created_transactions && data.created_transactions > 0) {
      html += `<div class="upload-success">${data.created_transactions} transactions added to your account</div>`;
    }
  }
  
  resultsContent.innerHTML = html;
}

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
