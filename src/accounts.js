// Accounts Page JavaScript
let currentUser = null;
let userAccounts = [];
let financialSummary = {};
let expandedAccounts = new Set(); // Track which accounts have expanded summaries

function formatTransactionDate(dateString) {
  // Parse date string directly to avoid timezone conversion issues
  if (!dateString) return 'Unknown Date';
  
  // If it's already in YYYY-MM-DD format, parse it directly
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateString.split('-');
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  }
  
  // Fallback to Date parsing for other formats
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch (error) {
    console.error('Error parsing date:', dateString, error);
    return 'Invalid Date';
  }
}

// API Configuration - uses build-time environment variables
const API_CONFIG = {
  getBaseUrl: function() {
    // Method 1: Use runtime environment variables (injected by build script)
    if (window.REACT_APP_API_URL) {
      return window.REACT_APP_API_URL;
    }
    
    // Method 2: Use global window variable (fallback)
    if (window.API_URL) {
      return window.API_URL;
    }
    
    // Method 3: Use meta tag (alternative)
    const metaApiUrl = document.querySelector('meta[name="api-url"]');
    if (metaApiUrl) {
      return metaApiUrl.getAttribute('content');
    }
    
    // Method 4: Fallback based on environment detection
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:7071/api';
    } else {
      return '/api';
    }
  },
  
  // Debug method to log current configuration
  logConfig: function() {
    console.log('API Configuration:', {
      hostname: window.location.hostname,
      baseUrl: this.getBaseUrl(),
      environment: this.getEnvironment(),
      runtimeEnv: window.REACT_APP_API_URL || 'N/A',
      debug: window.REACT_APP_DEBUG || 'N/A'
    });
  },
  
  getEnvironment: function() {
    if (window.REACT_APP_ENVIRONMENT) {
      return window.REACT_APP_ENVIRONMENT;
    }
    
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'development';
    } else if (hostname.includes('.azurestaticapps.net')) {
      return 'production';
    } else {
      return 'production';
    }
  }
};

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
  initializePage();
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
      
      // console.log('Current user initialized:', currentUser);
      
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
      console.log('Error loading financial summary');
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
      console.log('Loaded accounts:', userAccounts);
    } else {
      console.log('No accounts found or error loading accounts');
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
  // console.log('Displaying accounts:', userAccounts);
  
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
  // console.log('goBack() function called');
  window.location.href = window.getNavigationUrl('/dashboard', '/financialTracking.html');
}

function goToCreateAccount() {
  window.location.href = window.getNavigationUrl('/dashboard', '/financialTracking.html');
}

function handleSignOut() {
  if (window.msalInstance) {
    window.msalInstance.logout();
    localStorage.clear();
    window.location.replace('/index.html');
  } else {
    localStorage.clear();
    window.location.replace('/index.html');
  }
}

// Test function for debugging
async function testAccountSummary() {
  try {
    console.log('Testing account summary...');
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/test-account-summary`, {
      method: 'GET'
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Test result:', result);
      return result;
    } else {
      console.error('Test failed:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Utility Functions
function showLoading(show) {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

function showMessage(message, type) {
  // Remove existing messages
  const existingMessages = document.querySelectorAll('.message');
  existingMessages.forEach(msg => msg.remove());
  
  // Create new message
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;
  
  // Insert at the top of the container
  const container = document.querySelector('.container');
  container.insertBefore(messageDiv, container.firstChild);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 5000);
}

// Close modals when clicking outside
window.onclick = function(event) {
  const modal = document.getElementById('accountSummaryModal');
  if (event.target === modal) {
    closeAccountSummaryModal();
  }
}

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

  console.log('Deleting account:', accountToDelete);
  showLoading(true);
  
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/accounts/${accountToDelete}`, {
      method: 'DELETE'
    });
    
    console.log('Delete response status:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('Delete result:', result);
      showMessage(result.message || 'Account deleted successfully!', 'success');
      
      // Close the modal
      closeDeleteAccountModal();
      
      // Reload the accounts list
      console.log('Reloading user data after deletion...');
      await loadUserData();
      console.log('User accounts after reload:', userAccounts);
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

