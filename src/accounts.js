// Accounts Page JavaScript
let currentUser = null;
let userAccounts = [];
let financialSummary = {};
let expandedAccounts = new Set(); // Track which accounts have expanded summaries

// Use centralized formatTransactionDate from utils.js

// Use centralized API_CONFIG from config.js

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
  initializePage();
});

// Refresh data when page becomes visible (e.g., when navigating back from financial tracking page)
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    // Force refresh of data to get latest information
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
      
      // Test account summary for debugging
      // await testAccountSummary();
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
    
    // Load financial summary and accounts
    await Promise.all([
      loadFinancialSummary(),
      loadUserAccounts()
    ]);
    
    // Update dashboard
    updateFinancialSummary();
    displayAccounts();
    
    // Load account charts in the background (optional)
    // setTimeout(() => {
    //   loadAllAccountCharts();
    // }, 1000);
    
  } catch (error) {
    console.error('Error loading user data:', error);
    showMessage('Error loading data. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadFinancialSummary() {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/financial-summary`, {
      method: 'GET'
    });
    
    if (response.ok) {
      financialSummary = await response.json();
    } else {
      financialSummary = {};
    }
  } catch (error) {
    console.error('Error loading financial summary:', error);
    financialSummary = {};
  }
}

async function loadUserAccounts() {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts`, {
      method: 'GET'
    });
    
    if (response.ok) {
      userAccounts = await response.json();
    } else {
      userAccounts = [];
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
    userAccounts = [];
  }
}

function updateFinancialSummary() {
  // Update total accounts
  document.getElementById('totalAccounts').textContent = financialSummary.total_accounts || 0;
  
  // Update total balance
  const totalBalance = financialSummary.total_balance || 0;
  document.getElementById('totalBalance').textContent = `$${totalBalance.toFixed(2)}`;
  
  // Update monthly income
  const monthlyIncome = financialSummary.monthly_income || 0;
  document.getElementById('monthlyIncome').textContent = `$${monthlyIncome.toFixed(2)}`;
  
  // Update monthly expenses
  const monthlyExpenses = financialSummary.monthly_expense || 0;
  document.getElementById('monthlyExpenses').textContent = `$${monthlyExpenses.toFixed(2)}`;
}

function displayAccounts() {
  const container = document.getElementById('accountsList');
  
  if (userAccounts.length === 0) {
    container.innerHTML = `
      <div class="no-data">
        <p>No accounts found. Create your first account to get started!</p>
        <button class="btn btn-primary" onclick="goToCreateAccount()">Create Account</button>
      </div>
    `;
    return;
  }
  
  container.innerHTML = userAccounts.map(account => {
    const balance = parseFloat(account.current_balance || 0);
    const balanceClass = balance >= 0 ? 'positive' : 'negative';
    const isExpanded = expandedAccounts.has(account.account_id);
    
    return `
      <div class="account-item">
        <div class="account-header">
          <div class="account-info">
            <h3>${account.account_name}</h3>
            <p>${account.account_type.charAt(0).toUpperCase() + account.account_type.slice(1)} Account</p>
          </div>
          <div class="account-balance">
            <p class="balance ${balanceClass}">$${balance.toFixed(2)}</p>
          </div>
        </div>
        
        <div class="account-actions">
          <button class="btn btn-small" onclick="toggleAccountSummary('${account.account_id}')">
            <span class="icon">${isExpanded ? '▼' : '▶'}</span>
            ${isExpanded ? 'Hide' : 'View'} Summary
          </button>
          <button class="btn btn-small btn-danger" onclick="confirmDeleteAccount('${account.account_id}', '${account.account_name}')">
            <span class="icon">🗑️</span>
            Delete
          </button>
        </div>
        
        <div id="summary-${account.account_id}" class="account-summary ${isExpanded ? 'show' : ''}">
          <div class="loading-placeholder">Loading summary...</div>
        </div>
        
      </div>
    `;
  }).join('');
}

async function toggleAccountSummary(accountId) {
  const summaryElement = document.getElementById(`summary-${accountId}`);
  const isExpanded = expandedAccounts.has(accountId);
  
  if (isExpanded) {
    // Collapse
    expandedAccounts.delete(accountId);
    summaryElement.classList.remove('show');
    setTimeout(() => {
      summaryElement.style.display = 'none';
    }, 300);
  } else {
    // Expand
    expandedAccounts.add(accountId);
    summaryElement.style.display = 'block';
    summaryElement.classList.add('show');
    
    // Load account summary if not already loaded
    if (summaryElement.innerHTML.includes('Loading summary...')) {
      await loadAccountSummary(accountId);
    }
  }
  
  // Update button text without regenerating the entire accounts list
  updateAccountButton(accountId);
}

async function loadAccountSummary(accountId) {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts/summary/${accountId}`, {
      method: 'GET'
    });
    
    if (response.ok) {
      const summary = await response.json();
      displayAccountSummary(accountId, summary);
    } else {
      const errorText = await response.text();
      let errorMessage = 'Error loading summary';
      try {
        const error = JSON.parse(errorText);
        errorMessage = error.message || error.error || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }
      displayAccountSummaryError(accountId, errorMessage);
    }
  } catch (error) {
    console.error('Error loading account summary:', error);
    displayAccountSummaryError(accountId, 'Network error: ' + error.message);
  }
}

function displayAccountSummary(accountId, summary) {
  const summaryElement = document.getElementById(`summary-${accountId}`);
  
  if (!summaryElement) {
    console.error('Summary element not found for account:', accountId);
    return;
  }
  
  if (summary.error) {
    displayAccountSummaryError(accountId, summary.error);
    return;
  }
  
  const recentTransactions = summary.recent_transactions || [];
  const transactionsHtml = recentTransactions.length > 0 
    ? recentTransactions.map(transaction => {
        const amount = parseFloat(transaction.amount);
        const transactionType = transaction.transaction_type;
        const amountClass = transactionType === 'income' ? 'income' : 'expense';
        const amountDisplay = transactionType === 'income' ? `+$${amount.toFixed(2)}` : `-$${amount.toFixed(2)}`;
        
        return `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-description">
                ${transaction.description}
                ${transaction.is_recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
              </div>
              <div class="transaction-details">${transaction.category} • ${formatTransactionDate(transaction.transaction_date)}</div>
            </div>
            <div class="transaction-actions">
              <div class="transaction-amount ${amountClass}">${amountDisplay}</div>
              <button class="btn btn-small btn-danger" onclick="confirmDeleteTransaction('${transaction.RowKey}', '${transaction.description}', '${accountId}')" title="Delete transaction">
                <span class="icon">🗑️</span>
              </button>
            </div>
          </div>
        `;
      }).join('')
    : '<p class="no-data">No recent transactions</p>';
  
  summaryElement.innerHTML = `
    <div class="summary-stats">
      <div class="summary-stat">
        <h4>Total Transactions</h4>
        <p>${summary.total_transactions || 0}</p>
      </div>
      <div class="summary-stat">
        <h4>Monthly Income</h4>
        <p>$${(summary.monthly_income || 0).toFixed(2)}</p>
      </div>
      <div class="summary-stat">
        <h4>Monthly Expenses</h4>
        <p>$${(summary.monthly_expense || 0).toFixed(2)}</p>
      </div>
      <div class="summary-stat">
        <h4>Last Transaction</h4>
        <p>${summary.last_transaction_date ? formatTransactionDate(summary.last_transaction_date) : 'None'}</p>
      </div>
    </div>
    
    <div class="recent-transactions">
      <h4>Recent Transactions</h4>
      <div class="transaction-list">
        ${transactionsHtml}
      </div>
    </div>
  `;
}

function displayAccountSummaryError(accountId, errorMessage) {
  const summaryElement = document.getElementById(`summary-${accountId}`);
  summaryElement.innerHTML = `
    <div class="message error">
      ${errorMessage}
    </div>
  `;
}

function updateAccountButton(accountId) {
  // Find the button for this account and update its text
  const accountItem = document.querySelector(`#summary-${accountId}`).closest('.account-item');
  if (accountItem) {
    const button = accountItem.querySelector('.btn');
    if (button) {
      const isExpanded = expandedAccounts.has(accountId);
      const icon = button.querySelector('.icon');
      if (icon) {
        icon.textContent = isExpanded ? '▼' : '▶';
      }
      button.innerHTML = `
        <span class="icon">${isExpanded ? '▼' : '▶'}</span>
        ${isExpanded ? 'Hide' : 'View'} Summary
      `;
    }
  }
}

// Navigation Functions
function goBack() {
  window.location.href = window.getNavigationUrl('/dashboard', '/financialTracking.html');
}

function goToCreateAccount() {
  window.location.href = window.getNavigationUrl('/dashboard', '/financialTracking.html');
}

// Use centralized handleSignOut from utils.js


// Use centralized utility functions from utils.js

// Close modals when clicking outside - handled in the new window.onclick function below

function closeAccountSummaryModal() {
  document.getElementById('accountSummaryModal').style.display = 'none';
}

// Transaction deletion functions
function confirmDeleteTransaction(transactionId, description, accountId) {
  const confirmed = confirm(`Are you sure you want to delete this transaction?\n\nDescription: ${description}\n\nThis action cannot be undone and will update your account balance.`);
  
  if (confirmed) {
    deleteTransaction(transactionId, accountId);
  }
}

async function deleteTransaction(transactionId, accountId) {
  try {
    showLoading(true);
    
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions/${transactionId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      const result = await response.json();
      showMessage('Transaction deleted successfully!', 'success');
      
      // Invalidate cache after successful deletion
      if (window.cacheInvalidation) {
        window.cacheInvalidation.invalidateTransactionData();
        window.cacheInvalidation.invalidateUserData(); // Also invalidate user data for financial summary
        window.cacheInvalidation.invalidateAccountData(accountId); // Invalidate specific account data
      }
      
      // Store which accounts were expanded before refreshing
      const expandedAccountIds = Array.from(expandedAccounts);
      
      // Reload the account list to update individual account balances
      await loadUserAccounts();
      
      // Also reload the financial summary to update totals
      await loadFinancialSummary();
      updateFinancialSummary();
      
      // Redisplay the accounts with updated balances
      displayAccounts();
      
      // Reload summaries for all previously expanded accounts
      for (const expandedAccountId of expandedAccountIds) {
        await loadAccountSummary(expandedAccountId);
      }
      
    } else {
      const errorData = await response.json();
      showMessage(`Error deleting transaction: ${errorData.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('Error deleting transaction:', error);
    showMessage('Network error while deleting transaction. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

// Account deletion functionality
let accountToDelete = null;

function confirmDeleteAccount(accountId, accountName) {
  accountToDelete = accountId;
  document.getElementById('deleteAccountName').textContent = accountName;
  document.getElementById('deleteAccountModal').style.display = 'block';
}

function closeDeleteAccountModal() {
  document.getElementById('deleteAccountModal').style.display = 'none';
  accountToDelete = null;
}

async function deleteAccount() {
  if (!accountToDelete) {
    showMessage('No account selected for deletion.', 'error');
    return;
  }

  showLoading(true);
  
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts/${accountToDelete}`, {
      method: 'DELETE'
    });
    
    
    if (response.ok) {
      const result = await response.json();
      showMessage(result.message || 'Account deleted successfully!', 'success');
      
      // Invalidate cache after successful deletion
      if (window.cacheInvalidation) {
        window.cacheInvalidation.invalidateUserData();
      }
      
      // Close the modal
      closeDeleteAccountModal();
      
      // Reload the accounts list
      await loadUserData();
      displayAccounts();
      updateFinancialSummary();
    } else {
      const errorData = await response.json();
      console.error('Delete failed:', errorData);
      showMessage(errorData.error || 'Failed to delete account.', 'error');
    }
  } catch (error) {
    console.error('Error deleting account:', error);
    showMessage('Network error while deleting account. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

// Search functionality
function openSearchModal() {
  document.getElementById('searchModal').style.display = 'block';
  // Clear previous results
  document.getElementById('searchResults').style.display = 'none';
  document.getElementById('searchResultsList').innerHTML = '';
  
  // Prevent background scrolling
  document.body.classList.add('modal-open');
}

function closeSearchModal() {
  document.getElementById('searchModal').style.display = 'none';
  
  // Restore background scrolling
  document.body.classList.remove('modal-open');
}

function clearSearch() {
  document.getElementById('searchForm').reset();
  document.getElementById('searchResults').style.display = 'none';
  document.getElementById('searchResultsList').innerHTML = '';
}

async function performSearch(event) {
  if (event) {
    event.preventDefault();
  }
  
  try {
    // Get search parameters
    const description = document.getElementById('searchDescription').value.trim();
    const category = document.getElementById('searchCategory').value;
    const startDate = document.getElementById('searchStartDate').value;
    const endDate = document.getElementById('searchEndDate').value;
    const transactionType = document.getElementById('searchTransactionType').value;
    
    // Build query parameters
    const params = new URLSearchParams();
    if (description) params.append('description', description);
    if (category) params.append('category', category);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (transactionType) params.append('transaction_type', transactionType);
    params.append('limit', '100');
    
    // Show loading state
    const resultsContainer = document.getElementById('searchResults');
    const resultsList = document.getElementById('searchResultsList');
    
    resultsContainer.style.display = 'block';
    resultsList.innerHTML = '<div class="search-loading">Searching transactions...</div>';
    
    // Make API request
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions/search?${params.toString()}`, {
      method: 'GET'
    });
    
    if (response.ok) {
      const searchData = await response.json();
      displaySearchResults(searchData);
    } else {
      const errorData = await response.json();
      resultsList.innerHTML = `
        <div class="search-no-results">
          <h4>Search Error</h4>
          <p>${errorData.error || 'Failed to search transactions'}</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error performing search:', error);
    const resultsList = document.getElementById('searchResultsList');
    resultsList.innerHTML = `
      <div class="search-no-results">
        <h4>Search Error</h4>
        <p>Network error while searching. Please try again.</p>
      </div>
    `;
  }
}

function displaySearchResults(searchData) {
  const resultsList = document.getElementById('searchResultsList');
  const transactions = searchData.transactions || [];
  
  if (transactions.length === 0) {
    resultsList.innerHTML = `
      <div class="search-no-results">
        <h4>No Transactions Found</h4>
        <p>No transactions match your search criteria. Try adjusting your filters.</p>
      </div>
    `;
    return;
  }
  
  const resultsHtml = transactions.map(transaction => {
    const amount = parseFloat(transaction.amount);
    const transactionType = transaction.transaction_type;
    const amountClass = transactionType === 'income' ? 'income' : 'expense';
    const amountDisplay = transactionType === 'income' ? `+$${amount.toFixed(2)}` : `-$${amount.toFixed(2)}`;
    
    return `
      <div class="search-result-item">
        <div class="search-result-info">
          <div class="search-result-description">
            ${transaction.description}
            ${transaction.is_recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
          </div>
          <div class="search-result-details">
            <span class="search-result-account">${transaction.account_name}</span>
            <span>${transaction.category}</span>
            <span>${formatTransactionDate(transaction.transaction_date)}</span>
          </div>
        </div>
        <div class="search-result-actions">
          <div class="search-result-amount ${amountClass}">${amountDisplay}</div>
          <button class="btn btn-small btn-danger" onclick="confirmDeleteTransaction('${transaction.RowKey}', '${transaction.description}', '${transaction.account_id}')" title="Delete transaction">
            <span class="icon">🗑️</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  resultsList.innerHTML = resultsHtml;
}

// Recurring Transactions Functions
function openRecurringModal() {
  document.getElementById('recurringModal').style.display = 'block';
  
  // Prevent background scrolling
  document.body.classList.add('modal-open');
  
  // Load recurring transactions
  loadRecurringTransactions();
}

function closeRecurringModal() {
  document.getElementById('recurringModal').style.display = 'none';
  
  // Restore background scrolling
  document.body.classList.remove('modal-open');
}

async function loadRecurringTransactions(forceRefresh = false) {
  try {
    let url = `${API_CONFIG.getBaseUrl()}/recurring-transactions`;
    
    // Add cache-busting parameter if force refresh is requested
    if (forceRefresh) {
      url += `?t=${Date.now()}`;
    }
    
    const response = await makeAuthenticatedRequest(url, {
      method: 'GET'
    });
    
    if (response.ok) {
      const recurringData = await response.json();
      displayRecurringTransactions(recurringData);
    } else {
      const errorData = await response.json();
      displayRecurringError(errorData.error || 'Failed to load recurring transactions');
    }
  } catch (error) {
    console.error('Error loading recurring transactions:', error);
    displayRecurringError('Network error while loading recurring transactions. Please try again.');
  }
}

function displayRecurringTransactions(recurringData) {
  const content = document.getElementById('recurringContent');
  const transactions = recurringData.recurring_transactions || [];
  
  if (transactions.length === 0) {
    content.innerHTML = `
      <div class="recurring-no-transactions">
        <h4>No Recurring Transactions</h4>
        <p>You don't have any recurring transactions set up yet.</p>
        <p>Create recurring transactions from the main dashboard to see them here.</p>
      </div>
    `;
    return;
  }
  
  const transactionsHtml = transactions.map(transaction => {
    const amount = parseFloat(transaction.amount);
    const transactionType = transaction.transaction_type;
    const amountClass = transactionType === 'income' ? 'income' : 'expense';
    const amountDisplay = transactionType === 'income' ? `+$${amount.toFixed(2)}` : `-$${amount.toFixed(2)}`;
    
    // Format occurrence dates
    const occurrenceDates = transaction.occurrence_dates || [];
    const formattedDates = occurrenceDates.map(date => {
      const dateObj = new Date(date);
      return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
    }).join(', ');
    
    // Format next occurrence
    let nextOccurrenceHtml = '';
    if (transaction.next_occurrence) {
      const nextDate = new Date(transaction.next_occurrence);
      const nextFormatted = `${nextDate.getMonth() + 1}/${nextDate.getDate()}/${nextDate.getFullYear()}`;
      nextOccurrenceHtml = `
        <div class="recurring-next-occurrence">
          Next: ${nextFormatted}
        </div>
      `;
    }
    
    return `
      <div class="recurring-transaction-item">
        <div class="recurring-transaction-info">
          <div class="recurring-transaction-description">
            ${transaction.description}
          </div>
          <div class="recurring-transaction-details">
            <span class="recurring-transaction-account">${transaction.account_name}</span>
            <span>${transaction.category}</span>
            <span class="recurring-transaction-frequency">${transaction.frequency}</span>
          </div>
          <div class="recurring-transaction-dates">
            <div class="recurring-dates-title">Occurrence Dates:</div>
            <div class="recurring-dates-list">
              <span class="recurring-date-badge">${formattedDates}</span>
              ${nextOccurrenceHtml}
            </div>
          </div>
        </div>
        <div class="recurring-transaction-actions">
          <div class="recurring-transaction-amount ${amountClass}">${amountDisplay}</div>
          <button class="btn btn-small btn-danger" onclick="confirmDeleteRecurringTransaction('${transaction.template_id}', '${transaction.description}', '${transaction.account_id}')" title="Delete all occurrences">
            <span class="icon">🗑️</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  content.innerHTML = `
    <div class="recurring-transactions-list">
      ${transactionsHtml}
    </div>
  `;
}

function displayRecurringError(errorMessage) {
  const content = document.getElementById('recurringContent');
  content.innerHTML = `
    <div class="recurring-error">
      <h4>Error Loading Recurring Transactions</h4>
      <p>${errorMessage}</p>
    </div>
  `;
}

function refreshRecurringTransactions() {
  const content = document.getElementById('recurringContent');
  content.innerHTML = `
    <div class="recurring-loading">
      <div class="loading-spinner"></div>
      <p>Refreshing recurring transactions...</p>
    </div>
  `;
  
  // Clear cache before refreshing
  if (window.cacheInvalidation) {
    window.cacheInvalidation.invalidateRecurringTransactions();
  }
  
  loadRecurringTransactions(true);
}

// Delete recurring transaction functions
function confirmDeleteRecurringTransaction(templateId, description, accountId) {
  const confirmed = confirm(`Are you sure you want to delete ALL occurrences of this recurring transaction?\n\nDescription: ${description}\n\nThis will delete all historical and future occurrences and update your account balance. This action cannot be undone.`);
  
  if (confirmed) {
    deleteRecurringTransaction(templateId, description, accountId);
  }
}

async function deleteRecurringTransaction(templateId, description, accountId) {
  try {
    showLoading(true);
    
    // Get all recurring transactions for this template
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/recurring-transactions`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      showMessage('Error loading recurring transactions for deletion.', 'error');
      return;
    }
    
    const recurringData = await response.json();
    const transactions = recurringData.recurring_transactions || [];
    
    // Find the specific template
    const template = transactions.find(t => t.template_id === templateId);
    if (!template) {
      showMessage('Recurring transaction template not found.', 'error');
      return;
    }
    
    // Get all transaction IDs for this template
    const transactionIds = await getTransactionIdsForTemplate(template);
    
    if (transactionIds.length === 0) {
      showMessage('No transactions found for this template.', 'error');
      return;
    }
    
    // Delete all transactions
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const transactionId of transactionIds) {
      try {
        const deleteResponse = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions/${transactionId}`, {
          method: 'DELETE'
        });
        
        if (deleteResponse.ok) {
          deletedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`Error deleting transaction ${transactionId}:`, error);
        failedCount++;
      }
    }
    
    if (deletedCount > 0) {
      showMessage(`Successfully deleted ${deletedCount} recurring transaction occurrences!`, 'success');
      
      // Invalidate cache
      if (window.cacheInvalidation) {
        window.cacheInvalidation.invalidateRecurringTransactions();
        window.cacheInvalidation.invalidateUserData();
        window.cacheInvalidation.invalidateAccountData(accountId);
      }
      
      // Add a small delay to ensure backend has processed all deletions
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh the recurring transactions view with force refresh
      await loadRecurringTransactions(true);
      
      // Also refresh the main accounts data
      await loadUserData();
      updateFinancialSummary();
      displayAccounts();
      
    } else {
      showMessage('Failed to delete any transactions.', 'error');
    }
    
    if (failedCount > 0) {
      showMessage(`Warning: ${failedCount} transactions could not be deleted.`, 'error');
    }
    
  } catch (error) {
    console.error('Error deleting recurring transaction:', error);
    showMessage('Network error while deleting recurring transactions. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

async function getTransactionIdsForTemplate(template) {
  try {
    // Search for all transactions matching this template
    const searchParams = new URLSearchParams();
    searchParams.append('description', template.description);
    searchParams.append('limit', '1000'); // Get all matching transactions
    
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/transactions/search?${searchParams.toString()}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return [];
    }
    
    const searchData = await response.json();
    const transactions = searchData.transactions || [];
    
    // Filter for transactions that match this template exactly
    const matchingTransactions = transactions.filter(transaction => 
      transaction.description === template.description &&
      parseFloat(transaction.amount) === template.amount &&
      transaction.category === template.category &&
      transaction.account_id === template.account_id &&
      (transaction.is_recurring === true || transaction.is_recurring === 'True')
    );
    
    return matchingTransactions.map(t => t.RowKey);
    
  } catch (error) {
    console.error('Error getting transaction IDs for template:', error);
    return [];
  }
}

// Close modals when clicking outside
window.onclick = function(event) {
  const searchModal = document.getElementById('searchModal');
  const recurringModal = document.getElementById('recurringModal');
  const accountSummaryModal = document.getElementById('accountSummaryModal');
  const deleteAccountModal = document.getElementById('deleteAccountModal');
  
  if (event.target === searchModal) {
    closeSearchModal();
  } else if (event.target === recurringModal) {
    closeRecurringModal();
  } else if (event.target === accountSummaryModal) {
    closeAccountSummaryModal();
  } else if (event.target === deleteAccountModal) {
    closeDeleteAccountModal();
  }
}

