
// Global utility functions
window.isProduction = function() {
  return window.location.hostname !== 'localhost' && 
         !window.location.hostname.includes('127.0.0.1') &&
         !window.location.hostname.includes('azurewebsites.net');
};

window.getNavigationUrl = function(productionPath, localPath) {
  return window.isProduction() ? productionPath : localPath;
};

// Wait for MSAL library to load
window.addEventListener('load', async function() {
  // Initialize AuthService
  const authService = AuthService.getInstance();
  await authService.initialize();
});

// Implement login function
function signIn() {
  const authService = AuthService.getInstance();
  
  authService.signIn()
    .then(response => {
      // Handle successful login
      const account = response.account;
      const familyName = account.idTokenClaims.family_name;
      const givenName = account.idTokenClaims.given_name;
      
      // Redirect immediately to login page using environment-based navigation
      window.location.replace(window.getNavigationUrl('/login', '/loggedIn.html'));
    })
    .catch(error => {
      // Handle login error
      console.error('Login failed:', error);
    });
};
  
// Secure API request function with caching
async function makeAuthenticatedRequest(url, options = {}) {
  const authService = AuthService.getInstance();
  return await authService.makeAuthenticatedRequest(url, options);
}

// Check if user is already logged in
  /*
  const currentAccounts = msalInstance.getAllAccounts();
  if (currentAccounts && currentAccounts.length > 0) {
    updateUIAfterLogin(currentAccounts[0]);
  } */
  
// Function to determine redirect URI based on environment
