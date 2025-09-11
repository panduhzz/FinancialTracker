// Financial Tracking JavaScript
let currentUser = null;
let userAccounts = [];
let recentTransactions = [];

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
    
    // Load accounts and transactions
    await Promise.all([
      loadUserAccounts(),
      loadRecentTransactions()
    ]);
    
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
    const response = await fetch(`${API_CONFIG.getBaseUrl()}/accounts`, {
      method: 'GET',
      headers: {
        'X-User-ID': currentUser.id,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      userAccounts = await response.json();
      populateAccountSelect();
    } else {
      console.log('No accounts found or error loading accounts');
      userAccounts = [];
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
    userAccounts = [];
  }
}

async function loadRecentTransactions() {
  try {
    const response = await fetch(`${API_CONFIG.getBaseUrl()}/transactions/recent`, {
      method: 'GET',
      headers: {
        'X-User-ID': currentUser.id,
        'Content-Type': 'application/json'
      }
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
  const totalBalance = userAccounts.reduce((sum, account) => sum + (account.current_balance || 0), 0);
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
          <div class="transaction-details">${transaction.category} • ${new Date(transaction.transaction_date).toLocaleDateString()}</div>
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
}

function closeCreateAccountModal() {
  document.getElementById('createAccountModal').style.display = 'none';
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
}

function closeAddTransactionModal() {
  document.getElementById('addTransactionModal').style.display = 'none';
}

// Form Handlers
document.getElementById('createAccountForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const accountData = {
    account_name: formData.get('accountName'),
    account_type: formData.get('accountType'),
    bank_name: formData.get('bankName') || '',
    initial_balance: parseFloat(formData.get('initialBalance')) || 0,
    description: formData.get('accountDescription') || ''
  };
  
  try {
    showLoading(true);
    
    const response = await fetch(`${API_CONFIG.getBaseUrl()}/accounts`, {
      method: 'POST',
      headers: {
        'X-User-ID': currentUser.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(accountData)
    });
    
    if (response.ok) {
      const newAccount = await response.json();
      userAccounts.push(newAccount);
      
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
  const transactionData = {
    account_id: formData.get('transactionAccount'),
    amount: parseFloat(formData.get('transactionAmount')),
    description: formData.get('transactionDescription'),
    category: formData.get('transactionCategory'),
    transaction_type: formData.get('transactionType'),
    transaction_date: formData.get('transactionDate') || new Date().toISOString().split('T')[0]
  };
  
  try {
    showLoading(true);
    
    const response = await fetch(`${API_CONFIG.getBaseUrl()}/transactions`, {
      method: 'POST',
      headers: {
        'X-User-ID': currentUser.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionData)
    });
    
    if (response.ok) {
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
      
      showMessage('Transaction added successfully!', 'success');
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

function viewAllAccounts() {
  window.location.href = '/accounts.html';
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

// Close modals when clicking outside
window.onclick = function(event) {
  const createModal = document.getElementById('createAccountModal');
  const transactionModal = document.getElementById('addTransactionModal');
  
  if (event.target === createModal) {
    closeCreateAccountModal();
  }
  if (event.target === transactionModal) {
    closeAddTransactionModal();
  }
}
